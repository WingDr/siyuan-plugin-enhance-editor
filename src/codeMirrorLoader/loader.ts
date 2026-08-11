import { EditorView, KeyBinding, keymap, lineNumbers } from "@codemirror/view";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { openSearchPanel } from "@codemirror/search";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { autocompletion, closeBrackets, Completion, CompletionContext } from "@codemirror/autocomplete";
import { html } from "@codemirror/lang-html";
import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { sql } from "@codemirror/lang-sql";
import { bracketMatching, language } from "@codemirror/language";
import {EditorCompletions} from "./editorCompletions";
import PluginEnhanceEditor from "../index";
import {githubLight} from "@ddietr/codemirror-themes/github-light";
import {githubDark} from "@ddietr/codemirror-themes/github-dark";
import { isDev } from "../utils/constants";
import { history, redo, undo } from "@codemirror/commands";
import * as prettier from "prettier";
import * as prettierPluginLatex from "prettier-plugin-latex";
import { createLogger, ILogger } from "../utils/simple-logger";
import { CompletionFrequencyStore } from "../utils/completion-frequency";

interface EditorToolbarBridge {
    subElementCloseCB?: (() => void) | null;
    subElementResizeCB?: (() => void) | null;
}

export class EditorLoader {
    private logger: ILogger;
    private sessions = new Map<HTMLElement, () => void>();

    constructor(private plugin: PluginEnhanceEditor){
        this.logger = createLogger("Codemirror Loader");
    }

    public destroy() {
        [...this.sessions.values()].forEach(cleanup => cleanup());
        this.sessions.clear();
    }

    public async loadCodeMirror(root: HTMLElement, data_type: string, toolbar?: EditorToolbarBridge) {
        // 判断打开的块的类型
        const type = this.detectRenderType(data_type);
        // 如果是没做好处理的“未知”块就直接退出
        if (type === "unknown") return;

        this.sessions.get(root)?.();

        // 获取用户设置信息
        const userConfig = (window as unknown as {siyuan: any}).siyuan.config;
        // 白天黑夜模式，0是白，1是黑
        const mode  = userConfig.appearance.mode;
        // 插入快捷键获取
        const keymapList = userConfig.keymap;
        if (isDev) this.logger.info("获取到思源快捷键列表, keymap=>", keymapList);

        const ref_textarea = root.querySelector("textarea") as HTMLTextAreaElement | null;
        if (!ref_textarea || !ref_textarea.parentElement) {
            this.logger.warn("未找到思源源码编辑器 textarea，跳过 CodeMirror 加载");
            return;
        }

        // 源码编辑器属于弹窗 UI，不应直接继承正文编辑器可能非常大的字号。
        // 在隐藏原生 textarea 前读取其最终字号，以兼容思源缩放、主题和用户样式。
        const nativeEditorFontSize = window.getComputedStyle(ref_textarea).fontSize || "14px";
        const editorRow = ref_textarea.parentElement;
        const siyuanGutter = editorRow.querySelector(":scope > .protyle-linenumber__rows") as HTMLElement | null;
        const siyuanScroll = editorRow.closest(".protyle-util__scroll") as HTMLElement | null;
        const isNewLineNumberLayout = !!siyuanGutter;
        const originalTextareaStyle = ref_textarea.getAttribute("style");
        const originalTextareaTabIndex = ref_textarea.getAttribute("tabindex");
        const originalTextareaAriaHidden = ref_textarea.getAttribute("aria-hidden");
        const originalEditorRowStyle = editorRow.getAttribute("style");
        const originalGutterStyle = siyuanGutter?.getAttribute("style") ?? null;
        const originalScrollStyle = siyuanScroll?.getAttribute("style") ?? null;

        const container = document.createElement("div");
        container.setAttribute("class", "b3-text-field--text editor-enhance-container");
        container.setAttribute("style", "flex:1 1 auto;width:100%;max-height:calc(-44px + 80vh);min-height:48px;min-width:0;border-radius:0 0 var(--b3-border-radius-b) var(--b3-border-radius-b);font-family:var(--b3-font-family-code);position:relative");
        editorRow.insertBefore(container, ref_textarea);

        // 新版思源会在 input 时按 textarea 的可见宽度测量软换行高度。不能使用 display:none，
        // 否则其测量宽度为 0，行号栏会被撑到异常高度。
        editorRow.style.position = "relative";
        ref_textarea.style.position = "absolute";
        ref_textarea.style.inset = "0";
        ref_textarea.style.width = "100%";
        ref_textarea.style.height = "100%";
        ref_textarea.style.visibility = "hidden";
        ref_textarea.style.pointerEvents = "none";
        ref_textarea.style.resize = "none";
        ref_textarea.tabIndex = -1;
        ref_textarea.setAttribute("aria-hidden", "true");

        if (siyuanGutter) {
            siyuanGutter.style.display = "none";
        }
        if (siyuanScroll) {
            siyuanScroll.style.minHeight = "0";
            siyuanScroll.style.width = "100%";
        }

        // 旧版思源没有面板缩放手柄，仅在旧 DOM 上保留插件原来的右下角手柄。
        const dragHandle = isNewLineNumberLayout ? null : document.createElement("div");
        if (dragHandle) {
            dragHandle.setAttribute("style", "width:0;height:0;border-bottom:1em solid grey;border-left:1em solid transparent;position:absolute;bottom:0;right:0;cursor:nwse-resize;z-index:1");
            container.appendChild(dragHandle);
        }

        //设定内部样式
        const editorTheme = EditorView.theme({
            "&.cm-focused": {
                outline: "none"
            },
            ".cm-line": {
                "font-family": "var(--b3-font-family-code)"
            },
            ".cm-scroller": {
                "overflow": "auto",
                "max-height": "calc(-44px + 80vh)", 
                "min-height": "48px", 
                "min-width": "268px"
            },
            "&.cm-editor": {
                "background-color": "transparent",
                "font-size": nativeEditorFontSize
            },
            ".cm-nonmatchingBracket": {
                "background-color": "#bb555544 !important"
            },
            ".cm-tooltip-autocomplete": {
                "font-size": "var(--b3-font-size, 14px)",
                "line-height": 1.4,
                "z-index": 500
            },
            ".cm-gutters": {
                "background-color": "transparent",
                "border-right-color": "var(--b3-border-color)",
                "color": "var(--b3-theme-on-surface-light)"
            }
        });

        // 设定快捷键透传
        const keybinds:KeyBinding[] = [
            {
                key: "Mod-f", run: openSearchPanel, scope: "editor search-panel",stopPropagation:true, preventDefault: true
            },
            {
                key: "Mod-z", run: undo, scope: "editor", preventDefault: true,
                stopPropagation: true
            },
            {
                key: "Mod-y", run: redo, scope: "editor", preventDefault: true,stopPropagation: true
            },
            {
                key: "Mod-Enter", 
                run: () => {
                    ref_textarea.dispatchEvent(new KeyboardEvent("keydown", {
                        key: "Enter",
                        keyCode: 13,
                        ctrlKey: true
                    }));
                    return true;
                },
                shift: () => {
                    ref_textarea.dispatchEvent(new KeyboardEvent("keydown", {
                        key: "Enter",
                        keyCode: 13,
                        ctrlKey: true,
                        shiftKey: true
                    }));
                    return true;
                },stopPropagation:true, preventDefault: true
            },
            {
                key: "Escape",
                run: () => {
                    console.log("ESC");
                    ref_textarea.dispatchEvent(new KeyboardEvent("keydown", {
                        key: "Escape",
                        keyCode: 27
                    }));
                    return true;
                },stopPropagation:true, preventDefault: true
            }
        ];

        const restoreAttribute = (element: HTMLElement, name: string, value: string | null) => {
            if (value === null) {
                element.removeAttribute(name);
            } else {
                element.setAttribute(name, value);
            }
        };
        const restoreNativeLayout = () => {
            restoreAttribute(ref_textarea, "style", originalTextareaStyle);
            restoreAttribute(ref_textarea, "tabindex", originalTextareaTabIndex);
            restoreAttribute(ref_textarea, "aria-hidden", originalTextareaAriaHidden);
            restoreAttribute(editorRow, "style", originalEditorRowStyle);
            if (siyuanGutter) restoreAttribute(siyuanGutter, "style", originalGutterStyle);
            if (siyuanScroll) restoreAttribute(siyuanScroll, "style", originalScrollStyle);
            container.remove();
        };

        let startState: EditorState | null = null;
        try {
            switch (type) {
                case "math":
                    startState = await this.generateStateMath(ref_textarea, keybinds, editorTheme, mode);
                    break;
                case "sql/js":
                    startState = await this.generateStateSQLJS(ref_textarea, keybinds, editorTheme, mode);
                    break;
                case "html":
                    startState = await this.generateStateHTML(ref_textarea, keybinds, editorTheme, mode);
                    break;
            }
        } catch (error) {
            restoreNativeLayout();
            this.logger.error(error as Error);
            return;
        }

        // 避免漏判情况发生是还渲染编辑器
        if (!startState) {
            restoreNativeLayout();
            return;
        }
            
        const view = new EditorView({
            state:startState,
            parent: container
        });

        // 对container的监听，防止keydown数据冒泡触发其他东西
        const containerHandle = (e: Event) => {
            e.stopPropagation();
        };
        container.addEventListener("keydown", containerHandle);
        // 对原textarea的监听同步，兼容数学公式插件
        const refTextareaHandle = () => {
            if (view.state.doc.toString() == ref_textarea.value) {
                return;
            }
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: ref_textarea.value
                }
            });
        };
        ref_textarea.addEventListener("input", refTextareaHandle);

        let removeWindowResizeListeners: () => void = () => {};
        const mouseDownHandle = (e:MouseEvent) => {
            e.preventDefault();
            const scroll = container.querySelector(".cm-scroller") as HTMLElement;
            let isResizing = true;
            let lastX = e.clientX;
            let lastY = e.clientY;
            const handleMouseMove = (move_ev:MouseEvent) => {
                if (!isResizing) return;
        
                const deltaX = move_ev.clientX - lastX;
                const deltaY = move_ev.clientY - lastY;
        
                const newWidth = container.offsetWidth + deltaX;
                const newHeight = scroll.offsetHeight + deltaY;
        
                container.style.width = `${newWidth}px`;
                scroll.style.height = `${newHeight}px`;
                view.requestMeasure();
        
                lastX = move_ev.clientX;
                lastY = move_ev.clientY;
            };
            const handleMouseUp = () => {
                isResizing = false;
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
            };
            removeWindowResizeListeners = () => {
                isResizing = false;
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
            };
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
        };
        dragHandle?.addEventListener("mousedown", mouseDownHandle);

        const resizeObserver = new ResizeObserver(() => view.requestMeasure());
        resizeObserver.observe(root);

        const originalCloseCB = toolbar?.subElementCloseCB;
        const originalResizeCB = toolbar?.subElementResizeCB;
        let wrappedCloseCB: (() => void) | null = null;
        let wrappedResizeCB: (() => void) | null = null;
        let destroyed = false;
        const cleanup = () => {
            if (destroyed) return;
            destroyed = true;
            resizeObserver.disconnect();
            removeWindowResizeListeners();
            dragHandle?.removeEventListener("mousedown", mouseDownHandle);
            ref_textarea.removeEventListener("input", refTextareaHandle);
            container.removeEventListener("keydown", containerHandle);
            view.destroy();
            restoreNativeLayout();
            if (toolbar && toolbar.subElementCloseCB === wrappedCloseCB) {
                toolbar.subElementCloseCB = originalCloseCB;
            }
            if (toolbar && toolbar.subElementResizeCB === wrappedResizeCB) {
                toolbar.subElementResizeCB = originalResizeCB;
            }
            if (this.sessions.get(root) === cleanup) {
                this.sessions.delete(root);
            }
        };

        if (toolbar) {
            wrappedCloseCB = () => {
                try {
                    originalCloseCB?.();
                } finally {
                    cleanup();
                }
            };
            wrappedResizeCB = () => {
                originalResizeCB?.();
                view.requestMeasure();
            };
            toolbar.subElementCloseCB = wrappedCloseCB;
            toolbar.subElementResizeCB = wrappedResizeCB;
        }
        this.sessions.set(root, cleanup);

        view.focus();
        view.dispatch({
            selection: {
                anchor: 0,
                head: view.state.doc.length
            }
        });
    }

    private async generateStateMath(
        ref_textarea:HTMLTextAreaElement,
        keybinds: KeyBinding[],
        editorTheme: Extension,
        mode:any
    ): Promise<EditorState> {
        // 实时读取补全
        const editorCompletions = new EditorCompletions(this.plugin);
        const completionList = await editorCompletions.get();
        const frequencyStore = new CompletionFrequencyStore(this.plugin);
        await frequencyStore.load();
        const trackedCompletions = completionList.map(completion => frequencyStore.wrapCompletion(completion));

        const buildSortedOptions = (query: string) => {
            const filtered = trackedCompletions.filter((completion) => {
                const label = String(completion.label ?? "");
                return label.startsWith(query);
            });
            const sorted = filtered.sort((a: Completion, b: Completion) => {
                const freqA = frequencyStore.getCount(String(a.label ?? ""));
                const freqB = frequencyStore.getCount(String(b.label ?? ""));
                if (freqA !== freqB) {
                    return freqB - freqA;
                }
                const labelA = String(a.label ?? "");
                const labelB = String(b.label ?? "");
                if (labelA !== labelB) {
                    return labelA.localeCompare(labelB);
                }
                const typeA = String(a.type ?? "");
                const typeB = String(b.type ?? "");
                return typeA.localeCompare(typeB);
            });
            return sorted;
        };

        function mathCompletions(context: CompletionContext) {
            const word = context.matchBefore(/(\\[\w\{\}]*)/);
            if (!word || (word.from == word.to && !context.explicit))
                return null;
            if (!/^\\[A-Za-z]/.test(word.text))
                return null;
            else if (word.text.indexOf("{") != -1) {
                return {
                    from: word.from,
                    to: word.to + 1,
                    options: buildSortedOptions(word.text),
                    filter: false
                };
            }
            return {
                from: word.from,
                options: buildSortedOptions(word.text),
                filter: false
            };
        };

        const docValue = (await prettier.format(
            "$" + ref_textarea.value + "$",
            {
                printWidth: 80,
                useTabs: true,
                tabWidth: 2,
                parser: "latex-parser",
                plugins: [prettierPluginLatex]
            }
        )).slice(1,-1);

        // 禁用连字
        const mathOnlyTheme = EditorView.theme({
            ".cm-line": {
                "font-variant-ligatures": "none",
                "font-feature-settings": "\"liga\" 0, \"calt\" 0, \"dlig\" 0"
            },
            ".cm-content": {
                "font-variant-ligatures": "none",
                "font-feature-settings": "\"liga\" 0, \"calt\" 0, \"dlig\" 0"
            }
        });

        const startState = EditorState.create({
            doc: docValue,
            extensions: [
                keymap.of([...keybinds,...vscodeKeymap]),
                lineNumbers(),
                EditorView.lineWrapping,
                EditorView.updateListener.of((e) => {
                    // 自动同步到原本的textarea中，并触发input事件
                    const sync_val = e.state.doc.toString();
                    // 如果内容相同就不触发，避免循环触发
                    if (ref_textarea.value === sync_val) {
                        return;
                    }
                    ref_textarea.value = sync_val;
                    ref_textarea.dispatchEvent(new Event("input", {
                        bubbles: true,
                        cancelable: true
                    }));
                }),
                autocompletion({
                    defaultKeymap: false,
                    override: [mathCompletions]
                }),
                closeBrackets(),
                bracketMatching(),
                editorTheme,
                mathOnlyTheme,
                mode ? githubDark: githubLight,
                history()
                
            ]
        });
        return startState;
    }

    private async generateStateSQLJS(
        ref_textarea:HTMLTextAreaElement,
        keybinds: KeyBinding[],
        editorTheme: Extension,
        mode:any
    ): Promise<EditorState> {
        const languageConf = new Compartment;
        const docIsJs = /\/\/!js/.test(ref_textarea.value.slice(0, 20));

        const autoLanguage = EditorState.transactionExtender.of(tr => {
            if (!tr.docChanged) return null;
            const docIsJs = /\/\/!js/.test(tr.newDoc.sliceString(0, 20));
            const stateIsJs = tr.startState.facet(language) == javascriptLanguage;
            if (docIsJs == stateIsJs) return null;
            return {
                effects: languageConf.reconfigure(docIsJs ? javascript() : sql())
            };
        });

        const startState = EditorState.create({
            doc: ref_textarea.value,
            extensions: [
                keymap.of([...keybinds,...vscodeKeymap]),
                lineNumbers(),
                EditorView.lineWrapping,
                EditorView.updateListener.of((e) => {
                    // 自动同步到原本的textarea中，并触发input事件
                    const sync_val = e.state.doc.toString();
                    // 如果内容相同就不触发，避免循环触发
                    if (ref_textarea.value === sync_val) {
                        return;
                    }
                    ref_textarea.value = sync_val;
                    ref_textarea.dispatchEvent(new Event("input", {
                        bubbles: true,
                        cancelable: true
                    }));
                }),
                languageConf.of(docIsJs ? javascript() : sql()),
                autoLanguage,
                autocompletion(),
                bracketMatching(),
                closeBrackets(),
                editorTheme,
                mode ? githubDark: githubLight,
                history()
                
            ]
        });
        return startState;
    }

    private async generateStateHTML(
        ref_textarea:HTMLTextAreaElement,
        keybinds: KeyBinding[],
        editorTheme: Extension,
        mode:any
    ): Promise<EditorState> {
        const languageConf = new Compartment;
        const startState = EditorState.create({
            doc: ref_textarea.value,
            extensions: [
                keymap.of([...keybinds,...vscodeKeymap]),
                lineNumbers(),
                EditorView.lineWrapping,
                EditorView.updateListener.of((e) => {
                    // 自动同步到原本的textarea中，并触发input事件
                    const sync_val = e.state.doc.toString();
                    // 如果内容相同就不触发，避免循环触发
                    if (ref_textarea.value === sync_val) {
                        return;
                    }
                    ref_textarea.value = sync_val;
                    ref_textarea.dispatchEvent(new Event("input", {
                        bubbles: true,
                        cancelable: true
                    }));
                }),
                languageConf.of(html()),
                autocompletion(),
                editorTheme,
                mode ? githubDark: githubLight,
                history()
                
            ]
        });
        return startState;
    }

    private detectRenderType(data_type: string): string {
        switch (data_type) {
            case "inline-math":
                return "math";
            case "NodeMathBlock":
                return "math";
            case "NodeBlockQueryEmbed":
                return "sql/js";
            case "NodeHTMLBlock":
                return "html";
            default:
                return "unknown";
        }
    }

    private detectBlockType(protyleUtil:HTMLElement): string{
        const title = protyleUtil.querySelector(".fn__flex-1.resize__move") as HTMLElement;
        const innerText = title.innerText;
        if (innerText === (window as unknown as {siyuan: any}).siyuan.languages["inline-math"] || innerText === (window as unknown as {siyuan: any}).siyuan.languages["math"]){
            return "math";
        } else if (innerText === (window as unknown as {siyuan: any}).siyuan.languages["embedBlock"]){
            return "sql/js";
        } else if (innerText === "HTML"){
            return "html";
        } else return "unknown";
    }

}

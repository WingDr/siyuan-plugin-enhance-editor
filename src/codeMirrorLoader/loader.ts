import { EditorView, KeyBinding, keymap } from "@codemirror/view";
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

export class EditorLoader {
    private logger: ILogger;
    private ref_textarea_handle:() => void;
    private mouse_down_handle: (e:MouseEvent) => void;
    private container_handle: (e:Event) => void;

    constructor(private plugin: PluginEnhanceEditor){
        this.logger = createLogger("Codemirror Loader");
    }

    public async loadCodeMirror(root: HTMLElement, data_type: string) {
        // 判断打开的块的类型
        const type = this.detectRenderType(data_type);
        // 如果是没做好处理的“未知”块就直接退出
        if (type === "unknown") return;

        // 获取用户设置信息
        const userConfig = (window as unknown as {siyuan: any}).siyuan.config;
        // 白天黑夜模式，0是白，1是黑
        const mode  = userConfig.appearance.mode;
        // 插入快捷键获取
        const keymapList = userConfig.keymap;
        if (isDev) this.logger.info("获取到思源快捷键列表, keymap=>", keymapList);

        const ref_textarea = root.querySelector("textarea");
        const container = document.createElement("div");
        container.setAttribute("class", "b3-text-field--text");
        container.setAttribute("id", "editorEnhanceContainer");
        container.setAttribute("style", "width:100%;max-height: calc(-44px + 80vh); min-height: 48px; min-width: 268px; border-radius: 0 0 var(--b3-border-radius-b) var(--b3-border-radius-b); font-family: var(--b3-font-family-code);position:relative");
        ref_textarea.parentNode.insertBefore(container, ref_textarea);
        ref_textarea.style.display = "none";

        // 右下角的可拖动手柄
        const dragHandle = document.createElement("div");
        // container.setAttribute("style", ref_textarea.style.cssText);
        dragHandle.setAttribute("style", "width: 0px; height: 0px; border-bottom:1em solid grey;border-left:1em solid transparent;position:absolute;bottom: 0;right: 0;cursor: nwse-resize;z-index:1");
        container.appendChild(dragHandle);

        //设定内部样式
        const editorTheme = EditorView.theme({
            "&.cm-focused": {
                outline: "none"
            },
            ".cm-line": {
                "font-family": "var(--b3-font-family-code)"
            },
            ".cm-scroller": {
                "overflow": "scroll",
                "max-height": "calc(-44px + 80vh)", 
                "min-height": "48px", 
                "min-width": "268px"
            },
            "&.cm-editor": {
                "background-color": "transparent"
            },
            ".cm-nonmatchingBracket": {
                "background-color": "#bb555544 !important"
            },
            ".cm-tooltips-autocomplete": {
                "z-index": 2
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

        let startState = null;
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
            default:
                startState = null;
                break;
        }

        // 避免漏判情况发生是还渲染编辑器
        if (!startState) return; 
            
        const view = new EditorView({
            state:startState,
            parent: container
        });

        // 对container的监听，防止keydown数据冒泡触发其他东西
        this.container_handle = (e) => {
            e.stopPropagation();
        };
        container.addEventListener("keydown", this.container_handle);
        // 对原textarea的监听同步，兼容数学公式插件
        this.ref_textarea_handle = () => {
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
        ref_textarea.addEventListener("input", this.ref_textarea_handle);
        this.mouse_down_handle = (e:MouseEvent) => {
            e.preventDefault();
            const scroll = container.querySelector(".cm-scroller") as HTMLElement;
            console.log(scroll);
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
        
                lastX = move_ev.clientX;
                lastY = move_ev.clientY;
            };
            const handleMouseUp = () => {
                isResizing = false;
                window.removeEventListener("mousemove", handleMouseMove);
                window.removeEventListener("mouseup", handleMouseUp);
            };
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
        };
        dragHandle.addEventListener("mousedown", this.mouse_down_handle);
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
import {
    Plugin,
    getFrontend,
} from "siyuan";
import "./index.scss";
import { ILogger, createLogger } from "./utils/simple-logger";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import { autocompletion, closeBrackets, CompletionContext} from "@codemirror/autocomplete";
import {EditorCompletions} from "./editorCompletions";
import KernelApi from "./api/kernel-api";
import { isDev } from "./utils/constants";

const STORAGE_NAME = "menu-config";

export default class PluginEnhanceEditor extends Plugin {

    private isMobile: boolean;
    public kernelApi: KernelApi;

    private logger: ILogger;
    // 标记是否textarea为自动更新
    private updateMarker: boolean;

    onload() {
        this.data[STORAGE_NAME] = {
            openSideBarMemo: false
        };

        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";

        this.logger = createLogger("main");
        this.logger.info("main");
    }

    async onLayoutReady() {
        await this.loadData(STORAGE_NAME);

        this.kernelApi = new KernelApi();
        this.updateMarker = false;
        this.initHandleFunctions();
    }

    onunload() {
        // this.openSideBar(false);
    }

    private initHandleFunctions() {
        this.eventBus.on("open-noneditableblock", this.loadCodeMirror.bind(this));
    }

    private async loadCodeMirror(ev: Event) {
        if (isDev) this.logger.info("事件触发open-noneditableblock, event=>", ev);
        // console.log(ev);
        const protyle_util = (ev as any).detail.toolbar.subElement;
        const ref_textarea = (protyle_util as HTMLElement).querySelector("textarea");
        // console.log(ref_textarea);
        const container = document.createElement("div");
        // container.setAttribute("style", ref_textarea.style.cssText);
        container.setAttribute("class", "b3-text-field--text");
        container.setAttribute("style", "width:40vw;max-height: calc(-44px + 80vh); min-height: 48px; min-width: 268px; border-radius: 0 0 var(--b3-border-radius-b) var(--b3-border-radius-b); font-family: var(--b3-font-family-code);");
        ref_textarea.parentNode.insertBefore(container, ref_textarea);
        ref_textarea.style.display = "none";

        // 右下角的可拖动手柄
        const dragHandle = document.createElement("div");
        // container.setAttribute("style", ref_textarea.style.cssText);
        dragHandle.setAttribute("style", "width: 0px; height: 0px; border-bottom:1em solid grey;border-left:1em solid transparent;position: absolute;bottom: 0;right: 0;cursor: nwse-resize;");
        container.appendChild(dragHandle);
        function processResize(container:HTMLElement, handle:HTMLElement) {
            let isResizing = false;
            let lastX = 0;
            let lastY = 0;
    
            handle.addEventListener("mousedown", (e) => {
                e.preventDefault();
                isResizing = true;
                lastX = e.clientX;
                lastY = e.clientY;
            });
    
            window.addEventListener("mousemove", (e) => {
                if (!isResizing) return;
    
                const deltaX = e.clientX - lastX;
                const deltaY = e.clientY - lastY;
    
                const newWidth = container.offsetWidth + deltaX;
                const newHeight = container.offsetHeight + deltaY;
    
                container.style.width = `${newWidth}px`;
                container.style.height = `${newHeight}px`;
    
                lastX = e.clientX;
                lastY = e.clientY;
            });
    
            window.addEventListener("mouseup", () => {
                isResizing = false;
            });
        }
        processResize(container, dragHandle);

        //设定内部样式
        const editorTheme = EditorView.theme({
            "&.cm-focused": {
                outline: "none"
            },
            ".cm-line": {
                "font-family": "var(--b3-font-family-code)"
            }
        });

        // 实时读取补全
        const editorCompletions = new EditorCompletions(this);
        const completionList = await editorCompletions.get();

        function mathCompletions(context: CompletionContext) {
            const word = context.matchBefore(/(\\[\w\{\}]*)/);
            if (!word || (word.from == word.to && !context.explicit))
                return null;
            return {
                from: word.from,
                options: completionList
            };
        }

        const startState = EditorState.create({
            doc: ref_textarea.value,
            extensions: [
                keymap.of(vscodeKeymap),
                EditorView.lineWrapping,
                EditorView.updateListener.of((e) => {
                    // 自动同步到原本的textarea中，并触发input事件
                    const sync_val = e.state.doc.toString();
                    ref_textarea.value = sync_val;
                    this.updateMarker = true;
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
                editorTheme
            ]
        });
        const view = new EditorView({
            state:startState,
            parent: container
        });

        // 对原textarea的监听同步，兼容数学公式插件
        ref_textarea.addEventListener("input", (e) => {
            
            if (this.updateMarker) {
                this.updateMarker = false;
                return;
            }
            view.dispatch({
                changes: {
                    from: 0,
                    to: view.state.doc.length,
                    insert: ref_textarea.value
                }
            });
            
        });
        
        view.focus();
        
    }
}

import {
    Plugin,
    getFrontend,
} from "siyuan";
import "./index.scss";
import { ILogger, createLogger } from "./utils/simple-logger";
import KernelApi from "./api/kernel-api";
import { isDev } from "./utils/constants";
import { EditorLoader } from "./codeMirrorLoader/loader";

const STORAGE_NAME = "menu-config";

export default class PluginEnhanceEditor extends Plugin {

    private isMobile: boolean;
    public kernelApi: KernelApi;
    public editorLoader: EditorLoader;

    private logger: ILogger;
    private readonly loadCodeMirrorHandler = this.loadCodeMirror.bind(this);

    onload() {
        this.data[STORAGE_NAME] = {
            openSideBarMemo: false
        };

        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";

        this.logger = createLogger("main");
        this.logger.info("load");
    }

    async onLayoutReady() {
        await this.loadData(STORAGE_NAME);

        this.kernelApi = new KernelApi();
        this.editorLoader = new EditorLoader(this);
        this.initHandleFunctions();
    }

    onunload() {
        this.eventBus.off("open-noneditableblock", this.loadCodeMirrorHandler);
        this.editorLoader?.destroy();
        this.logger.info("unload");
    }

    private initHandleFunctions() {
        this.eventBus.on("open-noneditableblock", this.loadCodeMirrorHandler);
    }

    private async loadCodeMirror(ev: Event) {
        if (isDev) this.logger.info("事件触发open-noneditableblock, event=>", ev);
        const toolbar = (ev as any).detail.toolbar;
        const protyle_util = toolbar.subElement;
        const blockElement = (ev as any).detail.blockElement;
        const renderElement = (ev as any).detail.renderElement as HTMLElement;
        const renderType = renderElement.getAttribute("data-type");
        await this.editorLoader.loadCodeMirror(protyle_util, renderType, toolbar);
    }
}

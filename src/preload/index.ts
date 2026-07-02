import { contextBridge } from "electron";
import { codePulseApi } from "./codePulseApi";

contextBridge.exposeInMainWorld("codePulse", codePulseApi);

import vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CommandContext } from "@commands/models/GenericCommand";

class Logger {
  private extName = "rewst-buddy";
  private output = vscode.window.createOutputChannel(this.extName);
  public logFile = "";
  private maxLogSize = 1000;
  private maxLogFiles = 1;
  private intialized = false;

  public init(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration(this.extName);
    this.maxLogSize = config.get<number>("maxLogSize", 1000) * 1000;
    this.maxLogFiles = config.get<number>("maxLogFiles", 7);

    const logFilePath = vscode.Uri.joinPath(context.globalStorageUri);
    this.logFile = path.join(logFilePath.fsPath, `${this.extName}.log`);
    this.ensureLogDirAndFile();
  }

  private ensureLogDirAndFile() {
    if (!this.intialized) {
      return;
    }
    const dir = path.dirname(this.logFile);
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Ensure file exists
    if (!fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, "");
    }
  }

  info(message: any, showToUser = false) {
    this.log("INFO", message, showToUser);
  }

  error(message: any, showToUser = true) {
    this.log("ERROR", message, showToUser);
  }

  private log(level: string, message: any, showToUser: boolean) {
    this.rotateLogIfNeeded(this.logFile, this.maxLogSize, this.maxLogFiles);

    let formatted: string;
    const date = new Date().toLocaleTimeString();

    if (typeof message === "object") {
      console.log(message);
      try {
        formatted = `(${date})[${level}] ${JSON.stringify(message, null, 2)}`;
      } catch (err) {
        formatted = `(${date})[${level}] [Object could not be stringified: ${err}]`;
      }
    } else {
      formatted = `(${date})[${level}] ${message}`;
    }
    this.output.appendLine(formatted);
    console.log(formatted);

    try {
      this.ensureLogDirAndFile();
      if (this.intialized) {
        fs.appendFileSync(this.logFile, formatted + "\n");
      }
    } catch (err) {
      this.output.appendLine(
        `[LOGGER ERROR] Failed to write to log file: ${err}`
      );
    }

    if (showToUser) {
      if (level === "ERROR") {
        vscode.window.showErrorMessage(
          typeof message === "string" ? message : "Error occurred (see log)"
        );
      }
      else {
        vscode.window.showInformationMessage(
          typeof message === "string" ? message : "See log for details."
        );
      }
    }
  }

  rotateLogIfNeeded(logFile: string, maxSizeBytes: number, maxFiles: number) {
    if (!this.intialized) {
      return;
    }
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > maxSizeBytes) {
        // Rotate files: myextension.log.3 -> myextension.log.4, etc.
        for (let i = maxFiles - 1; i >= 1; i--) {
          const src = `${logFile}.${i}`;
          const dest = `${logFile}.${i + 1}`;
          if (fs.existsSync(src)) { fs.renameSync(src, dest); }
        }
        fs.renameSync(logFile, `${logFile}.1`);
        fs.writeFileSync(logFile, ""); // Create new log file
      }
    }
  }
}

export const log = new Logger();
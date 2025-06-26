import vscode from "vscode";
import { log } from "@log";

export interface ConflictModalOptions {
    templateName: string;
    message: string;
    buttons: {
        id: string;
        label: string;
        variant?: 'primary' | 'secondary' | 'danger';
    }[];
}

export class ConflictModal {
    private panel: vscode.WebviewPanel | undefined;
    private resolveCallback: ((value: string) => void) | undefined;

    constructor(private context: vscode.ExtensionContext) { }

    public async show(options: ConflictModalOptions): Promise<string> {
        return new Promise((resolve) => {
            this.resolveCallback = resolve;
            this.createPanel(options);
        });
    }

    private createPanel(options: ConflictModalOptions) {
        // Close existing panel if any
        if (this.panel) {
            this.panel.dispose();
        }

        this.panel = vscode.window.createWebviewPanel(
            'conflictModal',
            'Template Conflict',
            {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: false
            },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        // Prevent panel from being closed by user
        this.panel.onDidDispose(() => {
            // If panel is disposed, recreate it immediately
            if (this.resolveCallback) {
                setTimeout(() => {
                    this.createPanel(options);
                }, 100);
            }
        });

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage((message) => {
            if (message.command === 'buttonClick' && this.resolveCallback) {
                const callback = this.resolveCallback;
                this.resolveCallback = undefined;
                this.panel?.dispose();
                this.panel = undefined;
                callback(message.buttonId);
            }
        });

        // Set webview content
        this.panel.webview.html = this.getWebviewContent(options);

        log.info(`Created persistent conflict modal for template: ${options.templateName}`);
    }

    private getWebviewContent(options: ConflictModalOptions): string {
        const buttonsHtml = options.buttons.map(button => {
            const variantClass = button.variant === 'danger' ? 'danger' :
                button.variant === 'primary' ? 'primary' : 'secondary';
            return `
        <button 
          class="button ${variantClass}" 
          onclick="sendMessage('${button.id}')"
          id="btn-${button.id}"
        >
          ${button.label}
        </button>
      `;
        }).join('');

        return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Template Conflict</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: transparent;
            overflow: hidden;
            height: 100vh;
            position: relative;
          }
          
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            z-index: 999999;
            pointer-events: all;
          }
          
          .modal-container {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 400px;
            max-width: calc(100vw - 40px);
            background: var(--vscode-editor-background);
            border: 2px solid var(--vscode-panel-border);
            border-radius: 8px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            z-index: 1000000;
            animation: slideIn 0.3s ease-out;
            pointer-events: all;
          }
          
          @keyframes slideIn {
            from {
              transform: translateX(100%);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
          
          .modal-header {
            padding: 16px 20px;
            background: var(--vscode-titleBar-activeBackground);
            color: var(--vscode-titleBar-activeForeground);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
            display: flex;
            align-items: center;
          }
          
          .modal-icon {
            width: 20px;
            height: 20px;
            margin-right: 10px;
            fill: var(--vscode-notificationsWarningIcon-foreground);
          }
          
          .modal-body {
            padding: 20px;
          }
          
          .template-name {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 8px;
          }
          
          .message {
            line-height: 1.5;
            margin-bottom: 20px;
            color: var(--vscode-descriptionForeground);
          }
          
          .button-container {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            flex-wrap: wrap;
          }
          
          .button {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            border-radius: 4px;
            cursor: pointer;
            font-size: var(--vscode-font-size);
            font-family: var(--vscode-font-family);
            transition: all 0.2s ease;
            min-width: 80px;
            text-align: center;
          }
          
          .button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          
          .button.primary:hover {
            background: var(--vscode-button-hoverBackground);
          }
          
          .button.danger {
            background: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
            border-color: var(--vscode-errorForeground);
          }
          
          .button.danger:hover {
            background: var(--vscode-errorForeground);
            opacity: 0.8;
          }
          
          .button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          
          .button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }
          
          .pulse {
            animation: pulse 2s infinite;
          }
          
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.02); }
            100% { transform: scale(1); }
          }
          
          /* Prevent any interaction with background */
          .modal-overlay {
            pointer-events: all !important;
          }
          
          /* Ensure modal stays on top */
          .modal-container {
            position: fixed !important;
            z-index: 2147483647 !important;
          }
        </style>
      </head>
      <body>
        <div class="modal-overlay" onclick="return false;"></div>
        <div class="modal-container pulse">
          <div class="modal-header">
            <svg class="modal-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.568 1.031A.715.715 0 0 0 8 .8a.715.715 0 0 0-.568.231l-6.4 7.2a.8.8 0 0 0-.032.832A.715.715 0 0 0 1.6 9.6h1.216L3.2 14.4a.8.8 0 0 0 .8.8h8a.8.8 0 0 0 .8-.8l.384-4.8H14.4a.715.715 0 0 0 .6-.537.8.8 0 0 0-.032-.832l-6.4-7.2zM8 11.2a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6zM8 7.2a.8.8 0 0 1-.8-.8V4.8a.8.8 0 0 1 1.6 0v1.6a.8.8 0 0 1-.8.8z"/>
            </svg>
            Template Conflict Resolution Required
          </div>
          <div class="modal-body">
            <div class="template-name">${options.templateName}</div>
            <div class="message">${options.message}</div>
            <div class="button-container">
              ${buttonsHtml}
            </div>
          </div>
        </div>
        
        <script>
          // Prevent all escape mechanisms
          document.addEventListener('keydown', function(e) {
            // Prevent Escape key
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              return false;
            }
            // Prevent Ctrl+W (close tab)
            if (e.ctrlKey && e.key === 'w') {
              e.preventDefault();
              e.stopPropagation();
              return false;
            }
          }, true);
          
          // Prevent context menu
          document.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            return false;
          });
          
          // Prevent text selection
          document.addEventListener('selectstart', function(e) {
            if (e.target.tagName !== 'BUTTON') {
              e.preventDefault();
              return false;
            }
          });
          
          // Prevent dragging
          document.addEventListener('dragstart', function(e) {
            e.preventDefault();
            return false;
          });
          
          // Block background clicks
          document.querySelector('.modal-overlay').addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            return false;
          });
          
          // VS Code API
          const vscode = acquireVsCodeApi();
          
          function sendMessage(buttonId) {
            vscode.postMessage({
              command: 'buttonClick',
              buttonId: buttonId
            });
          }
          
          // Focus the modal container to ensure it captures keyboard events
          document.querySelector('.modal-container').focus();
          
          // Prevent any form of closing
          window.addEventListener('beforeunload', function(e) {
            e.preventDefault();
            e.returnValue = '';
            return '';
          });
          
          // Add subtle animation to draw attention
          setInterval(function() {
            const container = document.querySelector('.modal-container');
            container.classList.remove('pulse');
            setTimeout(() => container.classList.add('pulse'), 50);
          }, 5000);
        </script>
      </body>
      </html>
    `;
    }

    public dispose() {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
        this.resolveCallback = undefined;
    }
}
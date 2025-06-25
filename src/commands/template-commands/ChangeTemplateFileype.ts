import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import * as vscode from 'vscode';
import { Template } from "@fs/models";
import { log } from "@log";

export class ChangeTemplateFiletypePowershell extends GenericCommand {
    commandName = 'ChangeTemplateFiletypePowershell';
    async execute(...args: any): Promise<void> {
        log.info('ChangeTemplateFiletypePowershell command started');
        try {
            const entry = args[0][0] ?? undefined;
            log.info(`Changing template filetype to PowerShell for: ${entry?.label || 'unknown'} (${entry?.id || 'unknown'})`);

            entry.ext = 'ps1';
            log.info('Successfully changed template extension to ps1');
            
            vscode.commands.executeCommand('rewst-buddy.RefreshView', entry);
            vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);
            
            log.info('ChangeTemplateFiletypePowershell command completed');
            return;
        } catch (error) {
            log.error(`ChangeTemplateFiletypePowershell command failed: ${error}`);
            throw error;
        }
    }
}

export class ChangeTemplateFiletypeHTML extends GenericCommand {
    commandName = 'ChangeTemplateFiletypeHTML';
    async execute(...args: any): Promise<void> {
        log.info('ChangeTemplateFiletypeHTML command started');
        try {
            const entry = args[0][0] ?? undefined;
            log.info(`Changing template filetype to HTML for: ${entry?.label || 'unknown'} (${entry?.id || 'unknown'})`);

            entry.ext = 'html';
            log.info('Successfully changed template extension to html');
            
            vscode.commands.executeCommand('rewst-buddy.RefreshView', entry);
            vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);
            
            log.info('ChangeTemplateFiletypeHTML command completed');
            return;
        } catch (error) {
            log.error(`ChangeTemplateFiletypeHTML command failed: ${error}`);
            throw error;
        }
    }
}

export class ChangeTemplateFiletypeYAML extends GenericCommand {
    commandName = 'ChangeTemplateFiletypeYAML';
    async execute(...args: any): Promise<void> {
        log.info('ChangeTemplateFiletypeYAML command started');
        try {
            const entry = args[0][0] ?? undefined;
            log.info(`Changing template filetype to YAML for: ${entry?.label || 'unknown'} (${entry?.id || 'unknown'})`);

            entry.ext = 'yml';
            log.info('Successfully changed template extension to yml');
            
            vscode.commands.executeCommand('rewst-buddy.RefreshView', entry);
            vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);
            
            log.info('ChangeTemplateFiletypeYAML command completed');
            return;
        } catch (error) {
            log.error(`ChangeTemplateFiletypeYAML command failed: ${error}`);
            throw error;
        }
    }
}

export class ChangeTemplateFiletypeCustom extends GenericCommand {
    commandName = 'ChangeTemplateFiletypeCustom';
    async execute(...args: any): Promise<void> {
        log.info('ChangeTemplateFiletypeCustom command started');
        try {
            const entry = args[0][0] ?? undefined;
            log.info(`Custom template filetype change requested for: ${entry?.label || 'unknown'} (${entry?.id || 'unknown'})`);

            if (!(entry instanceof Template)) {
                log.error('Entry is not a Template instance, cannot change filetype');
                return;
            }

            log.info('Prompting user for custom extension');
            const ext = await vscode.window.showInputBox({
                placeHolder: 'ps1',
                prompt: 'Enter an extension (ex: html)',
                validateInput: (input) => {
                    return /^[a-zA-Z0-9 ]*$/.test(input)
                        ? undefined
                        : 'Please use alpha-numerics';
                }
            });

            if (ext) {
                log.info(`User provided custom extension: ${ext}`);
                entry.ext = ext;
                log.info(`Successfully changed template extension to: ${ext}`);
            } else {
                log.info('User cancelled custom extension input');
            }

            vscode.commands.executeCommand('rewst-buddy.RefreshView', entry);
            vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);

            log.info('ChangeTemplateFiletypeCustom command completed');
            return;
        } catch (error) {
            log.error(`ChangeTemplateFiletypeCustom command failed: ${error}`);
            throw error;
        }
    }
}



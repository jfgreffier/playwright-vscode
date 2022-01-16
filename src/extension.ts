/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import vscode from 'vscode';
import { CodelensProvider } from './codeLensProvider';
import { discardHighlightCaches, hideHighlight, highlight } from './highlighter';
import { TestModel } from './testModel';

export const testControllers: vscode.TestController[] = [];
export const testControllerEvents = new EventEmitter();

const debugSessions = new Map<string, vscode.DebugSession>();

export async function activate(context: vscode.ExtensionContext) {
  // When extension activates, list config files and register them in the model.
  const testModel = new TestModel();
  await addWorkspaceConfigsToModel(testModel);
  vscode.workspace.onDidChangeConfiguration((_) => {
    addWorkspaceConfigsToModel(testModel).catch(() => {});
  });

  const codeLensProvider = new CodelensProvider(testModel);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: 'typescript', scheme: 'file' }, codeLensProvider),
    vscode.commands.registerCommand("pw.extension.runTest", async (location: { file: string, line: number }, project: { projectName: string, configFile: string }) => {
      testModel.runTest(project.configFile, project.projectName, location);
    }),
    vscode.workspace.onDidSaveTextDocument(textEditor => {
      testModel.discardEntries(textEditor.uri.fsPath);
      codeLensProvider.onDidChangeCodeLensesEmitter.fire();
    }),
    vscode.debug.onDidStartDebugSession(session => {
      if (session.type === 'node-terminal' || session.type === 'pwa-node')
        debugSessions.set(session.id, session);
    }),
    vscode.debug.onDidTerminateDebugSession(session => {
      debugSessions.delete(session.id);
      hideHighlight();
      discardHighlightCaches();
    }),
    vscode.languages.registerHoverProvider('typescript', {
      provideHover(document, position, token) {
        highlight(debugSessions, document, position).catch();
        return null;
      }
    }),
    vscode.window.onDidChangeTextEditorSelection(event => {
      highlight(debugSessions, event.textEditor.document, event.selections[0].start).catch();
    }),
  );
}

async function addWorkspaceConfigsToModel(testModel: TestModel) {
  let isDogFood = false;
  try {
    const packages = await vscode.workspace.findFiles('package.json');
    if (packages.length === 1) {
      const content = await fs.promises.readFile(packages[0].fsPath, 'utf-8');
      if (JSON.parse(content).name === 'playwright-internal')
        isDogFood = true;
    }
  } catch {
  }
  testModel.reset(isDogFood);
  const files = await vscode.workspace.findFiles('**/*.config.[tj]s');
  for (const file of files) {
    const isPlaywrightConfig =
        file.fsPath.includes('playwright.config') ||
        (await fs.promises.readFile(file.fsPath, 'utf-8')).includes('// @playwright.config');
    if (isPlaywrightConfig)
      testModel.addConfig(vscode.workspace.getWorkspaceFolder(file)!.uri.fsPath, file.fsPath);
  }
}

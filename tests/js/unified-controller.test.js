'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const commands = new Map();
const providers = [];
const callbacks = {};
const settings = new Map();
const disposable = () => ({dispose(){}});
const mock = {
  env:{language:'en'}, StatusBarAlignment:{Left:1}, EndOfLine:{CRLF:2},
  DiagnosticSeverity:{Error:0, Warning:1, Information:2}, OverviewRulerLane:{Right:4},
  ThemeColor: class { constructor(id){this.id=id;} },
  Range: class { constructor(...args){this.args=args;} },
  TextEdit:{replace:(range,newText)=>({range,newText})},
  window:{
    visibleTextEditors:[], activeTextEditor:null,
    createOutputChannel:()=>({appendLine(){},dispose(){}}),
    createStatusBarItem:()=>({show(){},hide(){},dispose(){}}),
    createTextEditorDecorationType:()=>disposable(),
    onDidChangeActiveTextEditor:disposable,
    onDidChangeVisibleTextEditors:disposable,
    showInformationMessage(){}, showErrorMessage(){}, showWarningMessage(){}
  },
  languages:{
    createDiagnosticCollection:()=>({set(){},delete(){},clear(){},dispose(){}}),
    registerDocumentFormattingEditProvider:(selectors,provider)=>{providers.push({selectors,provider});return disposable();},
    onDidChangeDiagnostics:disposable, getDiagnostics:()=>[]
  },
  commands:{registerCommand:(name,handler)=>{
    assert.ok(!commands.has(name),'duplicate command '+name);
    commands.set(name,handler); return disposable();
  }},
  workspace:{
    textDocuments:[],
    getWorkspaceFolder:()=>null,
    getConfiguration:(section)=>({get:(key,fallback)=>settings.get(section+'.'+key) ?? fallback,inspect:()=>({})}),
    onWillSaveTextDocument:disposable,onDidSaveTextDocument:disposable,
    onDidOpenTextDocument:disposable,onDidCloseTextDocument:disposable,
    onDidChangeTextDocument:disposable,
    onDidChangeConfiguration:handler=>{callbacks.config=handler; return disposable();}
  }
};
const original = Module._load;
Module._load = function(name,...args){return name === 'vscode' ? mock : original.call(this,name,...args);};
const {NormFormatterExtension} = require('../../extension');
const {DiagnosticHighlighter} = require('../../lib/highlighter');
Module._load = original;

function document() {
  return {languageId:'python',uri:{scheme:'file',fsPath:'/tmp/main.py',toString:()=> 'file:///tmp/main.py'},
    fileName:'/tmp/main.py',version:1,isClosed:false,eol:1,lineCount:1,
    getText:()=> 'x=1\n',lineAt:()=>({range:{end:{line:0,character:4}}})};
}

test('activation registers both languages and unified commands route to Python', async () => {
  const context = {extensionPath:require('node:path').resolve(__dirname,'../..'), subscriptions:[]};
  const extension = new NormFormatterExtension(context);
  extension.register();
  assert.equal(providers.length,2);
  assert.ok(providers.some(p=>p.selectors.some(s=>s.language==='python')));
  mock.window.activeTextEditor = {document:document()};
  let format=0,check=0;
  extension.python.formatActiveEditor = async()=>format++;
  extension.python.checkCurrentFile = async()=>check++;
  await commands.get('normFormatter.formatDocument')();
  await commands.get('normFormatter.runCurrentFile')();
  assert.equal(format,1); assert.equal(check,1);
  const manifest = require('../../package.json');
  for(const c of manifest.contributes.commands) assert.ok(commands.has(c.command),c.command);
  context.subscriptions.forEach(s=>s.dispose());
});

test('Python formatting discards stale edits and preserves CRLF; save is optional', async () => {
  const extension = new NormFormatterExtension({extensionPath:'/extension',subscriptions:[]});
  const doc = document();
  extension.python.service.run = async()=> {doc.version++; return {formatted:'x = 1\n'};};
  assert.deepEqual(await extension.python.buildFormattingEdits(doc),[]);
  extension.python.service.run = async()=> ({formatted:'x = 1\n'});
  doc.eol=2;
  assert.equal((await extension.python.buildFormattingEdits(doc))[0].newText,'x = 1\r\n');
  let waiting;
  extension.python.onWillSave({document:doc,waitUntil:p=>waiting=p});
  assert.equal(waiting,undefined);
  settings.set('normFormatter.python.formatOnSave',true);
  extension.python.onWillSave({document:doc,waitUntil:p=>waiting=p});
  assert.equal((await waiting).length,1);
  settings.clear();
});

test('error highlighter applies only formatter issues and clears when disabled', () => {
  const applied=[];
  mock.window.visibleTextEditors=[{document:document(),setDecorations:(type,ranges)=>applied.push(ranges)}];
  mock.languages.getDiagnostics=()=>[
    {source:'mypy',severity:0,range:'error'}, {source:'flake8',severity:1,range:'warning'},
    {source:'other',severity:0,range:'unrelated'}
  ];
  const highlighter=new DiagnosticHighlighter({subscriptions:[]});
  highlighter.refresh();
  assert.deepEqual(applied,[['error'],['warning']]);
  settings.set('normFormatter.highlighter.enabled',false);
  highlighter.refresh();
  assert.deepEqual(applied.slice(2),[[],[]]);
  highlighter.dispose(); settings.clear(); mock.window.visibleTextEditors=[];
});

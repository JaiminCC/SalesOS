const fs=require('fs');
const ts=require('typescript');
const files=['apps/web/app/layout.jsx','apps/web/app/page.jsx','apps/web/components/Enterprise.jsx','apps/web/components/SalesOS.jsx','apps/web/components/data.js','apps/web/next.config.mjs','apps/web/postcss.config.js','apps/web/tailwind.config.js'];
let errors=0;
for(const path of files){const src=fs.readFileSync(path,'utf8');const mode=path.endsWith('.jsx')?ts.ScriptKind.JSX:ts.ScriptKind.JS;const sf=ts.createSourceFile(path,src,ts.ScriptTarget.Latest,true,mode);const ds=sf.parseDiagnostics||[];if(ds.length){errors+=ds.length;for(const d of ds) console.error(path,ts.flattenDiagnosticMessageText(d.messageText,' '))} else console.log('PASS syntax:',path)}
const root=fs.readFileSync('apps/web/components/SalesOS.jsx','utf8'), ent=fs.readFileSync('apps/web/components/Enterprise.jsx','utf8');
for(const id of ['command','agents','inspector','leads','campaigns','inbox','qualification','meetings','approvals','analytics','products','settings','preferences','security','sso','users','integrations','whatsapp','webhooks','audit']){if(!root.includes(`['${id}'`)) {errors++;console.error('Missing menu:',id)}}
for(const marker of ['EnterpriseAuth','remember','mfa','Forgot your password','Reset your password','Single Sign-On','Audit','WhatsApp','Connector','Permission','Webhook','Session']){if(!ent.includes(marker)){errors++;console.error('Missing flow marker',marker)}}
if(!root.includes('Enterprise page={page}')){errors++;console.error('Enterprise views not mounted')}
const banned=['Code Colonies','Sales Automation','Privacy Operations','Workflow Automation'];
const roots=['apps/api/src','apps/worker/src','packages/shared/src','packages/agent-core/src','packages/integrations/src'];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const child=dir+'/'+entry.name;if(entry.isDirectory()){if(entry.name!=='node_modules'&&entry.name!=='dist')walk(child)}else if(/\.(ts|js|mjs|cjs)$/.test(entry.name)){const text=fs.readFileSync(child,'utf8');for(const name of banned){if(text.includes(name)){errors++;console.error('Company-specific name:',name,child)}}}}}
for(const dir of roots) walk(dir);
console.log(errors?'FAIL checks: '+errors:'PASS source syntax and feature presence checks');process.exitCode=errors?1:0;

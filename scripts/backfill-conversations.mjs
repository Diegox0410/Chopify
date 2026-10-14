import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { prepareConversationBackfill } from '../api/_lib/conversationBackfill.js'
export async function runConversationBackfillDryRun(args=process.argv.slice(2)){
 if(args.some(arg=>arg==='--write'||arg==='--apply'))throw new Error('This CLI only prepares a local plan. Production backfill requires separate authorization and an audited runner.')
 const value=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined}
 const source=value('--source'),output=value('--output'),tenantId=value('--tenant')
 if(!source||!output||!tenantId)throw new Error('Use --source <local-export.json> --output <new-plan.json> --tenant <tenant-id>')
 const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
 const outputRelative=path.relative(repositoryRoot,path.resolve(output))
 if(!outputRelative.startsWith('..')&&!path.isAbsolute(outputRelative))throw new Error('Keep private backfill plans outside the repository')
 if(path.resolve(source)===path.resolve(output))throw new Error('Source export must be preserved')
 const snapshot=JSON.parse(await fs.readFile(source,'utf8'))
 const plan=prepareConversationBackfill({tenantId,records:snapshot.records,identities:snapshot.identities||[],capturedAt:snapshot.capturedAt})
 // Output may contain customer history: keep it outside repositories and never
 // print the plan or include it in the deployable source.
 if(path.resolve(output).includes(path.sep+'.git'+path.sep))throw new Error('Invalid backup destination')
 await fs.writeFile(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'})
 console.log(JSON.stringify({ok:true,tenantId,...plan.summary,mode:'DRY_RUN',fingerprint:plan.fingerprint}))
 return plan
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runConversationBackfillDryRun().catch(error=>{console.error(error.message);process.exitCode=1})

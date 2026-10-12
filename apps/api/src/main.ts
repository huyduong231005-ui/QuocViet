import {config} from 'dotenv';
import {resolve} from 'node:path';
import {createApp} from './app';
config({path:resolve(__dirname,'../../../.env'),quiet:true});
async function main(){const {app,db}=await createApp({logger:true});const port=Number(process.env.PORT||3000);await app.listen(port,process.env.HOST||'127.0.0.1');console.log(`ProcureIQ: http://127.0.0.1:${port}`);const shutdown=async()=>{await app.close();await db.close();process.exit(0)};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown)}
main().catch(error=>{console.error(error.message);process.exit(1)});


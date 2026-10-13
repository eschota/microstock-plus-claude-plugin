#!/usr/bin/env node
// Read-only API bootstrap. No MCP server, installer or credential persistence.
import {pathToFileURL} from 'node:url';

export const API_BASE = 'https://microstock.plus/api/agent/v1';
const MCP_URL = 'https://microstock.plus/mcp';
const MAX_REPLY_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^mpk_live_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/;
const SCOPE_PATTERN = /^[a-z]+:[a-z]+$/;
const trace = value => /^req_[0-9a-f]{24}$/.test(value || '') ? value : null;

export function mcpTemplate(client) {
  if (client === 'claude') return {mcpServers:{'microstock-plus':{type:'http',url:MCP_URL,headers:{Authorization:'Bearer ${MPLUS_API_KEY}'}}}};
  if (client === 'cursor') return {mcpServers:{'microstock-plus':{url:MCP_URL,headers:{Authorization:'Bearer ${env:MPLUS_API_KEY}'}}}};
  if (client === 'codex') return '[mcp_servers.microstock-plus]\nurl = "'+MCP_URL+'"\nbearer_token_env_var = "MPLUS_API_KEY"\n';
  throw new Error('unsupported_client');
}

async function boundedJSON(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_REPLY_BYTES) throw new Error('reply_too_large');
  if (!/\bapplication\/(?:[a-z0-9.+-]*\+)?json\b/i.test(response.headers.get('content-type') || '')) throw new Error('invalid_response_type');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty_response');
  const parts=[]; let length=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done) break;
      length+=value.byteLength;
      if(length>MAX_REPLY_BYTES) throw new Error('reply_too_large');
      parts.push(value);
    }
  } finally {await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length); let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('invalid_json');}
}

export async function connect({token,fetchImpl=globalThis.fetch,timeoutMs=15000}={}) {
  const base={mode:'direct_api',account_connected:false,portfolio_read_verified:false,mcp_configured:null,mcp_tools_available:null,mcp_check:'not_performed'};
  if(!TOKEN_PATTERN.test(String(token||'')))return {...base,ok:false,stage:'credentials',error_code:token?'invalid_token_format':'token_required'};
  async function get(path) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetchImpl(API_BASE+path,{method:'GET',redirect:'error',signal:controller.signal,
        headers:{Authorization:'Bearer '+token,Accept:'application/json','User-Agent':'microstock-plus-connect/1.0.0'}});
      const request_id=trace(response.headers.get('x-request-id'));
      if(!response.ok){
        let error_code=response.status===401?'authentication_failed':response.status===403?'permission_denied':response.status===429?'rate_limited':'http_error';
        try{
          const failure=await boundedJSON(response);
          if(['invalid_api_key','revoked_api_key','scope_required','rate_limited','not_found','upstream_unavailable'].includes(failure?.error?.code))error_code=failure.error.code;
        }catch{ /* The HTTP status remains authoritative when an error body is invalid. */ }
        const retryAfter=response.headers.get('retry-after');
        const delay=retryAfter?.trim()?Number(retryAfter):NaN;
        return {ok:false,http_status:response.status,request_id,error_code,
          ...(response.status===429&&Number.isFinite(delay)&&delay>=0&&delay<=3600?{retry_after_seconds:delay}:{})};
      }
      const data=await boundedJSON(response);
      return {ok:true,data,request_id};
    } catch(error) {
      const safe=new Set(['reply_too_large','invalid_response_type','empty_response','invalid_json']);
      return {ok:false,error_code:controller.signal.aborted?'request_timeout':safe.has(error?.message)?error.message:'network_error'};
    } finally {clearTimeout(timer);}
  }
  const account=await get('/me');
  if(!account.ok)return {...base,...account,stage:'account'};
  if(account.data?.object!=='account'||!Array.isArray(account.data?.key?.scopes))return {...base,ok:false,stage:'account',error_code:'invalid_account_response',request_id:account.request_id};
  const scopes=account.data.key.scopes.filter(value=>typeof value==='string'&&SCOPE_PATTERN.test(value));
  const verified={...base,account_connected:true,scopes,request_id:account.request_id};
  if(!scopes.includes('files:read'))return {...verified,ok:true,stage:'account_only',missing_scope:'files:read'};
  const folders=await get('/folders');
  if(!folders.ok)return {...verified,...folders,stage:'folders'};
  if(folders.data?.object!=='list'||!Array.isArray(folders.data?.data))return {...verified,ok:false,stage:'folders',error_code:'invalid_folders_response',request_id:folders.request_id};
  return {...verified,ok:true,stage:'api_ready',portfolio_read_verified:true,folder_count:folders.data.data.length,
    folder_list_complete:folders.data.has_more===false,request_id:folders.request_id};
}

async function main() {
  const args=process.argv.slice(2);
  if(args.includes('--help')){process.stdout.write('M+ read-only API check: set MPLUS_API_KEY or use --token-stdin. Optional --mcp-template claude|cursor|codex returns a secret-free example; it does not edit settings.\n');return;}
  let stdin=false,client=null;
  for(let index=0;index<args.length;index++) {
    if(args[index]==='--token-stdin')stdin=true;
    else if(args[index]==='--mcp-template')client=args[++index];
    else throw new Error('unknown_option');
  }
  if(client!==null&&!['claude','cursor','codex'].includes(client))throw new Error('unsupported_client');
  let token=process.env.MPLUS_API_KEY||'';
  if(stdin){token='';for await(const chunk of process.stdin){token+=chunk.toString();if(token.length>512)throw new Error('invalid_token_format');}token=token.trim();}
  const result=await connect({token});
  if(client&&result.ok)result.mcp_template={client,configuration:mcpTemplate(client),credential_environment:'MPLUS_API_KEY',applied:false};
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.ok)process.exitCode=1;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
  const known=new Set(['unknown_option','unsupported_client','invalid_token_format']);
  process.stdout.write(JSON.stringify({ok:false,stage:'local',error_code:known.has(error?.message)?error.message:'local_error'})+'\n');
  process.exitCode=1;
});

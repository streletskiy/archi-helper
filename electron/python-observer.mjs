import fs from 'node:fs/promises';
import {sanitizePythonObservation} from './tool-diagnostics.mjs';

// This runner observes only urllib JSON requests to the selected Archicad port.
// No script, URL, argument value, raw response or exception text enters its journal.
export const PYTHON_OBSERVER=String.raw`
import json, os, runpy, sys, threading, urllib.request
script, config_path, journal = sys.argv[1:4]
def run_script():
    sys.argv = [script]
    sys.path[0] = os.path.dirname(script)
    runpy.run_path(script, run_name='__main__')
try:
    with open(config_path, encoding='utf-8') as stream:
        config = json.load(stream)
    commands, fields, exceptions = set(config['commands']), set(config['fields']), set(config['exceptions'])
except Exception:
    run_script()
    raise SystemExit(0)
port = int(os.environ['ARCHICAD_PORT'])
lock, state = threading.Lock(), {'calls': 0, 'limited': False}

def emit(record):
    try:
        with lock, open(journal, 'a', encoding='utf-8') as stream:
            stream.write(json.dumps(record, ensure_ascii=True) + '\n')
    except Exception:
        pass

def limited():
    if not state['limited']:
        state['limited'] = True
        emit({'event': 'limited'})

def shape(value, depth=0, budget=None):
    if budget is None: budget = [160]
    budget[0] -= 1
    if budget[0] < 0: return 'object'
    if value is None: return 'null'
    if isinstance(value, bool): return 'boolean'
    if isinstance(value, (int, float)): return 'number'
    if isinstance(value, str): return 'string'
    if depth >= 5: return 'object'
    if isinstance(value, list): return [shape(value[0], depth+1, budget)] if value else []
    if isinstance(value, dict):
        items = list(value.items())[:24]
        result = {key: shape(item, depth+1, budget) for key, item in items if key in fields}
        if any(key not in fields for key, _ in items): result['[other]'] = 'object'
        return result
    return 'object'

def category(error):
    message = error.get('message', '') if isinstance(error, dict) else str(error)
    if not isinstance(message, str): message = ''
    for rule in config['errorRules']:
        if isinstance(error, dict) and 'code' in rule and error.get('code') == rule['code'] or rule['pattern'] in message:
            return rule['category']

def diagnostic(reply):
    data = reply.get('result', reply) if isinstance(reply, dict) else reply
    if isinstance(data, dict): data = data.get('addOnCommandResponse', data)
    result = {'kind': 'completed', 'fields': [], 'result_check': 'json_api_response', 'response_shape': shape(data)}
    errors = []
    if isinstance(reply, dict) and reply.get('succeeded') is False:
        errors.append(reply.get('error', {}))
    if isinstance(data, dict):
        entries = data.get('executionResults', data.get('elements', data.get('attributeIds')))
        if isinstance(entries, list):
            result['result_check'] = 'execution_results'
            errors.extend(item.get('error', {}) for item in entries if isinstance(item, dict) and (item.get('success') is False or item.get('error')))
        if data.get('success') is False or data.get('error'): errors.append(data.get('error', {}))
    if errors:
        result['kind'] = 'execution_failure'
        for error in errors:
            reason = category(error)
            if reason:
                result['api_error'] = reason
                break
    return result

def observe_response(response, index, input_shape):
    original_read, state = response.read, {'recorded': False}
    def read(*args, **kwargs):
        data = original_read(*args, **kwargs)
        if not state['recorded']:
            state['recorded'] = True
            try:
                if args and args[0] not in (None, -1) or kwargs.get('amt') not in (None, -1) or len(data) > config['maxResponseBytes']:
                    limited()
                else:
                    result = diagnostic(json.loads(data))
                    result['input_shape'] = input_shape
                    emit({'event': 'end', 'index': index, 'diagnostic': result})
            except Exception:
                limited()
        return data
    try:
        response.read = read
    except Exception:
        limited()
    return response

original = urllib.request.urlopen
def urlopen(request, *args, **kwargs):
    index, input_shape = None, {}
    try:
        from urllib.parse import urlsplit
        url = urlsplit(request.full_url if isinstance(request, urllib.request.Request) else request)
        raw = args[0] if args else kwargs.get('data', getattr(request, 'data', None))
        if url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost', '::1') and url.port == port and isinstance(raw, bytes):
            if len(raw) > config['maxResponseBytes']:
                raise ValueError('Observation input limit')
            body = json.loads(raw)
            command, parameters = body.get('command', ''), body.get('parameters', {})
            if command == 'API.ExecuteAddOnCommand' and parameters.get('addOnCommandId', {}).get('commandNamespace') == 'TapirCommand':
                command = parameters['addOnCommandId'].get('commandName', '')
                parameters = parameters.get('addOnCommandParameters', {})
            else:
                command = command.removeprefix('API.')
            if command in commands:
                with lock:
                    state['calls'] += 1
                    index = state['calls']
                if index <= config['maxCalls']:
                    input_shape = shape(parameters)
                    emit({'event': 'begin', 'index': index, 'command': command, 'input_shape': input_shape})
                else:
                    index = None
                    limited()
            else:
                limited()
    except Exception:
        index = None
        limited()
    try:
        response = original(request, *args, **kwargs)
    except Exception as error:
        if index is not None:
            kind = type(error).__name__
            report = {'kind': 'unknown_outcome', 'fields': [], 'result_check': 'unknown', 'input_shape': input_shape}
            if kind in exceptions: report['exception_type'] = kind
            emit({'event': 'end', 'index': index, 'diagnostic': report})
        raise
    return observe_response(response, index, input_shape) if index is not None else response

emit({'event': 'ready'})
urllib.request.urlopen = urlopen
run_script()
`;

export async function readPythonObservation(file) {
  let handle;
  try {
    handle=await fs.open(file,'r');const buffer=Buffer.alloc(524288),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
    const events=buffer.subarray(0,bytesRead).toString('utf8').split('\n'),calls=new Map();let ready=false,truncated=(await handle.stat()).size>bytesRead;
    for(const line of events.filter(Boolean)) {
      let event;try{event=JSON.parse(line);}catch{truncated=true;continue;}
      if(event.event==='ready')ready=true;
      if(event.event==='limited')truncated=true;
      if(!Number.isInteger(event.index)||event.index<1||event.index>40)continue;
      if(event.event==='begin')calls.set(event.index,{command:event.command,diagnostic:{kind:'unknown_outcome',fields:[],result_check:'unknown',input_shape:event.input_shape}});
      if(event.event==='end'&&calls.has(event.index))calls.get(event.index).diagnostic=event.diagnostic;
    }
    return sanitizePythonObservation({coverage:ready?'urllib_json_api':'unavailable',truncated,calls:[...calls].sort(([a],[b])=>a-b).map(([,call])=>call)});
  }catch{return {coverage:'unavailable',truncated:true,calls:[]};}
  finally{await handle?.close().catch(()=>{});}
}

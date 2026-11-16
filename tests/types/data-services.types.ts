import { createClient, startGateway, sessionIdSchema } from '../../build/data-services/index.ts';

function checkClient() {
  const client = createClient('http://127.0.0.1:1/rpc');
  const sessionId = sessionIdSchema.parse('00000000-0000-4000-8000-000000000000');
  const char: Promise<string> = client.glyph({sessionId,args:{value:'😀'}});
  const list: Promise<string[]> = client.repeat({sessionId,args:{value:['a','😀']}});
  const tuple: Promise<[string,[string[],string]]> = client.tuple({sessionId,args:{value:['a',[['😀'],'b']]}});
  void client.shape({sessionId,args:{value:{glyph:'a',rows:[['😀']],choice:{kind:'Letters',fields:{values:['b']}}}}});
  void startGateway({worker:{threads:4}});
  // @ts-expect-error Char is a scalar string, not a code number.
  void client.glyph({sessionId,args:{value:65}});
  // @ts-expect-error Char lists are JSON arrays, not Bend constructors.
  void client.repeat({sessionId,args:{value:{kind:'Con',head:'a',tail:[]}}});
  // @ts-expect-error Lifecycle state remains private.
  void client.observed({sessionId,args:{state:{},value:'a',letters:[]}});
  // @ts-expect-error Service workers do not expose a GPU profile.
  void startGateway({worker:{profile:'gpu'}});
  return [char,list,tuple];
}
void checkClient;

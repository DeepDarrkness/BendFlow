import { createClient, sessionIdSchema } from '../../build/portable-services/index.ts';

function checkClient() {
  const client = createClient('http://127.0.0.1:1/rpc');
  const sessionId = sessionIdSchema.parse('00000000-0000-4000-8000-000000000000');
  const number: Promise<number> = client.add({sessionId,args:{a:7,b:5}});
  const text: Promise<string> = client.nat({sessionId,args:{value:'281474976710655'}});
  const pair: Promise<[number,boolean]> = client.pair({sessionId,args:{value:[7,true]}});
  void client.answer({sessionId,args:{}});
  void client.unit({sessionId,args:{value:null}});
  void client.float({sessionId,args:{value:{bits:0x80000000}}});
  void client.packet({sessionId,args:{value:{enabled:true,count:'1',ratio:{bits:0},title:'',numbers:[],choice:{kind:'Absent',fields:{}},box:{value:{value:1}},empty:{}}}});
  // @ts-expect-error Nat is canonical decimal text, not a JS number.
  void client.nat({sessionId,args:{value:1}});
  // @ts-expect-error F32 requires named bits rather than a JSON float.
  void client.float({sessionId,args:{value:1.5}});
  // @ts-expect-error Pair has exact declared order.
  void client.pair({sessionId,args:{value:[true,7]}});
  // @ts-expect-error Multiple arguments are required by name.
  void client.add({sessionId,args:{a:7}});
  // @ts-expect-error Stateful store hides its native arrays/maps.
  void client.store({sessionId,args:{state:{},index:0,value:7,write:true}});
  // @ts-expect-error Imported api helper is not an endpoint.
  void client.hidden({sessionId,args:{value:7}});
  return [number,text,pair];
}
void checkClient;

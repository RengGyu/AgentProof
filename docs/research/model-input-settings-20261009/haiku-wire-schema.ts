/** Only wire constraints are translated; product validators remain unchanged. */
export function purposeWireSchema(schema:object):object {
 const supported=new Set(['type','properties','required','additionalProperties','items','enum','pattern','anyOf']);
 const localOnly=new Set(['minimum','maximum','minLength','maxLength','uniqueItems','maxItems','minItems']);
 const visit=(node:any):any=>{
  if(Array.isArray(node.anyOf)&&node.anyOf.every((x:any)=>x.type==='object'&&x.properties?.kind?.enum&&JSON.stringify(x.required)===JSON.stringify(node.anyOf[0].required))){
   const variants=node.anyOf, merged=structuredClone(variants[0]);
   for(const name of Object.keys(merged.properties)){
    const choices=variants.map((v:any)=>v.properties[name]);
    if(choices.every((v:any)=>JSON.stringify(v)===JSON.stringify(choices[0])))continue;
    if(choices.every((v:any)=>Array.isArray(v.enum)))merged.properties[name]={type:choices[0].type,enum:[...new Set(choices.flatMap((v:any)=>v.enum))]};
    else if(choices.every((v:any)=>v.type==='string')){merged.properties[name]={...choices[0]};delete merged.properties[name].pattern;}
    else throw Error('purpose_wire_union_unsupported');
   }
   const out=visit(merged);out.description='Conditional action rules (enforced locally): '+JSON.stringify(variants.map((v:any)=>({kind:v.properties.kind.enum,targetPattern:v.properties.targetId.pattern,view:v.properties.view.enum})));return out;
  }
  const out:any={},constraints:any={};
  for(const [k,v] of Object.entries(node)){
   if(localOnly.has(k)){if(k==='minItems'&&(v===0||v===1))out[k]=v;else constraints[k]=v;continue;}
   if(!supported.has(k))throw Error('purpose_wire_schema_unsupported');
   out[k]=k==='properties'?Object.fromEntries(Object.entries(v as object).map(([n,x])=>[n,visit(x)])):k==='items'?visit(v):k==='anyOf'?(v as any[]).map(visit):v;
  }
  if(Object.keys(constraints).length)out.description='Local validation constraints: '+JSON.stringify(constraints);
  return out;
 };return visit(schema);
}

import {readFileSync}from'node:fs';import{expect,it}from'vitest';
const sql=readFileSync('supabase/migrations/202610180001_mobile_push.sql','utf8');
it('keeps registry/delivery tables service-only, token encrypted and bound to current mobile membership',()=>{
 for(const required of ['enable row level security','from public, anon, authenticated, service_role','token_ciphertext','s.revoked_at is null','s.expires_at>now()',"s.auth_source='mobile'","m.status='active'",'agentproof_tenant_deletion_state','on delete cascade','new.revoked_at is not null'])expect(sql).toContain(required);
 expect(sql).not.toMatch(/token_plain|raw_code|rationale|request_body|grant .* to authenticated/i);
});
it('claims per event/device atomically, retries only explicit retriable outcomes twice and protects rotated tokens',()=>{
 for(const required of ['primary key(event_key,device_id)','on conflict on constraint agentproof_mobile_push_deliveries_pkey',"state='retryable'",'attempts<2','p_token_hash','r.id=p_report','r.tenant_id=p_tenant','g.save_reports_enabled'])expect(sql).toContain(required);
 expect(sql).not.toMatch(/state\s+in\s*\('unknown','retryable'\)/);
});

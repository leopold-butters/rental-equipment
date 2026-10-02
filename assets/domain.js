/* Pure business rules shared by the browser and Node tests. */
(function (root) {
  'use strict';
  const VERSION = 2, KEY = 'rental-equipment.db';
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  function day(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Некорректная дата.');
    const n = Date.parse(value+'T00:00:00Z');
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0,10) !== value) throw Error('Некорректная дата.');
    return n / 86400000;
  }
  const addDays = (value, n) => new Date((day(value)+n)*86400000).toISOString().slice(0,10);
  const duration = (start,end) => { const n=day(end)-day(start); if(n<0) throw Error('Дата возврата раньше даты выдачи.'); return Math.max(1,n); };
  const empty = () => ({version:VERSION, revision:0, equipment:[], clients:[], rentals:[], history:[], settings:{bounds:[7,14,21],employee:''}});
  function assert(ok, message) { if(!ok) throw Error(message); }
  function validate(db) {
    assert(db && db.version===VERSION,'Неподдерживаемая версия базы.');
    for(const key of ['equipment','clients','rentals','history']) {
      assert(Array.isArray(db[key]),'Повреждён раздел базы: '+key);
      const ids=new Set(); for(const x of db[key]) { assert(x && typeof x.id==='string' && x.id && !ids.has(x.id),'Некорректные или повторные идентификаторы: '+key); ids.add(x.id); }
    }
    const b=db.settings?.bounds;
    assert(Array.isArray(b) && b.length===3 && b.every((n,i)=>Number.isInteger(n)&&n>0&&n<=365&&(!i||n>b[i-1])),'Границы тарифов должны возрастать (1–365).');
    const inventories=new Set();
    for(const e of db.equipment) {
      assert(typeof e.name==='string'&&e.name.trim()&&typeof e.inventory==='string'&&e.inventory.trim(),'Заполните название и инвентарный номер.');
      const inv=e.inventory.trim().toLowerCase(); assert(!inventories.has(inv),'Инвентарный номер уже существует.'); inventories.add(inv);
      assert(Array.isArray(e.rates)&&e.rates.length===4&&e.rates.every(n=>Number.isFinite(n)&&n>=0&&n<=1e9),'Укажите четыре неотрицательных тарифа.');
      assert(['free','repair','inactive'].includes(e.status),'Некорректное состояние оборудования.');
      assert(!e.photo || /^data:image\/(jpeg|png|webp);base64,/.test(e.photo),'Неподдерживаемая фотография.');
    }
    for(const c of db.clients) {
      assert(typeof c.name==='string'&&c.name.trim(),'Заполните имя клиента.');
      assert(['person','company'].includes(c.type),'Некорректный тип клиента.');
      assert(!c.documents || Array.isArray(c.documents),'Некорректные документы.');
      for(const f of c.documents||[]) assert(typeof f.name==='string'&&/^data:(application\/pdf|image\/(jpeg|png|webp));base64,/.test(f.data),'Документы: только PDF, JPEG, PNG или WebP.');
    }
    for(const h of db.history) { assert(typeof h.operation==='string' && typeof h.timestamp==='string' && Number.isFinite(Date.parse(h.timestamp)), 'Некорректная запись истории.'); }
    const activeIds=new Set();
    for(const r of db.rentals) {
      day(r.start); if(r.due) { day(r.due); assert(day(r.due)>day(r.start),'Срок возврата должен быть позже выдачи.'); }
      assert(['active','closed'].includes(r.status),'Некорректная аренда.');
      assert(Number.isFinite(r.paid)&&r.paid>=0,'Некорректная сумма оплаты.');
      assert(Array.isArray(r.rates)&&r.rates.length===4&&r.rates.every(n=>Number.isFinite(n)&&n>=0&&n<=1e9),'Некорректные тарифы аренды.');
      assert(Array.isArray(r.bounds)&&r.bounds.length===3&&r.bounds.every((n,i)=>Number.isInteger(n)&&n>0&&n<=365&&(!i||n>r.bounds[i-1])),'Некорректные границы аренды.');
      if(r.status==='active') {
        assert(day(r.start)<=day(today()), 'Активная аренда не может начинаться в будущем.');
        assert(db.equipment.some(e=>e.id===r.equipmentId)&&db.clients.some(c=>c.id===r.clientId),'Активная аренда ссылается на отсутствующий объект.');
        assert(!activeIds.has(r.equipmentId),'Оборудование уже выдано.'); activeIds.add(r.equipmentId);
        assert(db.equipment.find(e=>e.id===r.equipmentId).status==='free','Нельзя выдать оборудование в ремонте или неактивное.');
      } else { day(r.end); assert(day(r.end)>=day(r.start),'Дата возврата раньше выдачи.'); const q=quote(r,r.end); assert(r.total===q.total&&r.days===q.days&&r.rate===q.rate,'Некорректный расчёт закрытой аренды.'); }
    }
    assert(Number.isInteger(db.revision)&&db.revision>=0,'Некорректная ревизия базы.');
    return db;
  }
  function migrate(input) {
    assert(input && Number.isInteger(input.version),'Файл не содержит версию базы.');
    assert(input.version<=VERSION,'Эта база создана более новой версией приложения.');
    const db=JSON.parse(JSON.stringify(input));
    if(db.version===1) {
      db.revision=db.revision||0; db.settings={bounds:[7,14,21],employee:'',...db.settings};
      db.rentals=(db.rentals||[]).map(r=>({...r,bounds:r.bounds||[7,14,21],paid:r.paid||0}));
      db.clients=(db.clients||[]).map(c=>({...c,documents:c.documents||[]})); db.version=2;
    }
    return validate(db);
  }
  function quote(r, end=today()) { const days=duration(r.start,end), tier=r.bounds.findIndex(n=>days<=n), index=tier<0?3:tier; const rate=r.rates[index]; return {days,index,rate,total:Math.round(days*rate*100)/100}; }
  const active = (db,id) => db.rentals.find(r=>r.equipmentId===id&&r.status==='active');
  const status = (db,e,date=today()) => { const r=active(db,e.id); return r ? r.due&&day(date)>day(r.due)?'overdue':'rented' : e.status; };
  function log(db,operation,details={}) { db.history.unshift({id:uid(),timestamp:new Date().toISOString(),operation,employee:db.settings.employee||'',...details}); }
  function issue(db, data) {
    const e=db.equipment.find(e=>e.id===data.equipmentId),c=db.clients.find(c=>c.id===data.clientId);
    assert(e&&c,'Выберите оборудование и клиента.'); assert(status(db,e)==='free','Оборудование недоступно для выдачи.');
    day(data.start); assert(day(data.start)<=day(today()),'Выдачу в будущем оформляйте в день передачи оборудования.');
    const days=Number(data.days); assert(data.days==='open'||Number.isInteger(days)&&days>=1&&days<=36500,'Срок: от 1 до 36500 дней.');
    const r={id:uid(),equipmentId:e.id,clientId:c.id,equipmentName:e.name,inventory:e.inventory,clientName:c.name,start:data.start,due:data.days==='open'?null:addDays(data.start,days),status:'active',rates:[...e.rates],bounds:[...db.settings.bounds],paid:Number(data.paid)||0,comment:data.comment||''};
    db.rentals.push(r); log(db,'Выдача',{...r,id:uid(),...quote(r,r.due||today())}); return r;
  }
  function close(db,id,end,paid) { const r=db.rentals.find(r=>r.id===id); assert(r?.status==='active','Аренда уже закрыта.'); assert(day(end)<=day(today()),'Нельзя принять возврат в будущем.'); const q=quote(r,end); Object.assign(r,{status:'closed',end,...q,paid:Number(paid)}); log(db,'Возврат',{...r,id:uid()}); return r; }
  function removeEquipment(db,id) { assert(!active(db,id),'Сначала примите возврат оборудования.'); const e=db.equipment.find(e=>e.id===id); assert(e,'Оборудование не найдено.'); log(db,'Удаление оборудования',{equipmentName:e.name,inventory:e.inventory}); db.equipment=db.equipment.filter(e=>e.id!==id); }
  function removeClient(db,id) { assert(!db.rentals.some(r=>r.clientId===id&&r.status==='active'),'У клиента есть активная аренда.'); const c=db.clients.find(c=>c.id===id); assert(c,'Клиент не найден.'); log(db,'Удаление клиента',{clientName:c.name}); db.clients=db.clients.filter(c=>c.id!==id); }
  const balance = (db,id,date=today()) => db.rentals.filter(r=>r.clientId===id).reduce((sum,r)=>sum+Math.max(0,(r.status==='closed'?r.total:quote(r,date).total)-r.paid),0);
  function statistics(db,from='0001-01-01',to='9999-12-31') {
    const selected=db.rentals.filter(r=>r.start>=from&&r.start<=to), closed=db.rentals.filter(r=>r.status==='closed'&&r.end>=from&&r.end<=to);
    const revenue=closed.reduce((s,r)=>s+r.total,0),received=closed.reduce((s,r)=>s+r.paid,0);
    const ranking=key=>Object.values(selected.reduce((a,r)=>{const id=r[key+'Id']; a[id] ||= {name:r[key+'Name'],count:0}; a[id].count++; return a;},{})).sort((a,b)=>b.count-a.count);
    return {rentals:selected.length,closed:closed.length,revenue,received,average:closed.length?revenue/closed.length:0,equipment:db.equipment.length,free:db.equipment.filter(e=>status(db,e)==='free').length,rented:db.rentals.filter(r=>r.status==='active').length,clients:db.clients.length,overdue:db.equipment.filter(e=>status(db,e)==='overdue').length,topEquipment:ranking('equipment'),topClients:ranking('client')};
  }
  function csv(rows) { return '\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??''); if(/^[\s]*[=+@-]/.test(s))s="'"+s; return '"'+s.replace(/"/g,'""')+'"';}).join(';')).join('\r\n'); }
  class LocalRepository {
    constructor(storage) {this.storage=storage; this.error=null; try {const raw=storage.getItem(KEY); this.db=raw?migrate(JSON.parse(raw)):empty();} catch(e) {this.error=e;this.db=null;} }
    commit(change) {
      assert(this.db&&!this.error,'База не загружена. Восстановите резервную копию.');
      const raw=this.storage.getItem(KEY), current=raw?migrate(JSON.parse(raw)):empty();
      assert(current.revision===this.db.revision,'База изменилась в другой вкладке. Обновите страницу и повторите действие.');
      const draft=JSON.parse(JSON.stringify(this.db)); change(draft); draft.revision++; validate(draft);
      try {this.storage.setItem(KEY,JSON.stringify(draft));} catch {throw Error('Не удалось сохранить базу. Освободите место в браузере или уменьшите фотографии. Изменения не применены.');}
      this.db=draft; return draft;
    }
    restore(value) { const db=migrate(value); db.revision=Math.max(db.revision,this.db?.revision||0)+1; try {this.storage.setItem(KEY,JSON.stringify(db));} catch {throw Error('Не удалось сохранить резервную копию. Недостаточно места.');} this.db=db;this.error=null; return db; }
  }
  const api={VERSION,KEY,uid,today,day,addDays,duration,empty,validate,migrate,quote,active,status,log,issue,close,removeEquipment,removeClient,balance,statistics,csv,LocalRepository};
  if(typeof module!=='undefined') module.exports=api; else root.Rental=api;
})(globalThis);

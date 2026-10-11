const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.ULTRA_PLAYWRIGHT_MODULE);
async function waitForWindowShown(page,selector){
  await page.waitForFunction(selector=>{
    const win=document.querySelector(selector);
    return win && win.getClientRects().length>0 && getComputedStyle(win).opacity==='1'
      && win.getAnimations().every(animation=>animation.playState==='finished');
  },selector);
}
(async()=>{
  const base=process.env.ULTRA_BROWSER_BASE,out=process.env.ULTRA_BROWSER_OUTPUT;assert.equal(process.env.ULTRA_BROWSER_FIXTURE,'copied-records');
  const browser=await chromium.launch({executablePath:process.env.ULTRA_BROWSER_EXECUTABLE});
  try{
    for(const [name,viewport] of [['desktop',{width:1440,height:960}],['phone',{width:390,height:844}]]){
      const page=await browser.newPage({viewport});const external=[],errors=[];
      page.on('request',r=>{if(!r.url().startsWith(base+'/')&&!r.url().startsWith('data:')&&!r.url().startsWith('blob:'))external.push(r.url());});
      page.on('pageerror',e=>errors.push(String(e&&e.message||e)));
      await page.goto(base+'/');
      await page.waitForSelector('#bottombar',{state:'attached',timeout:20000});
      assert.equal(await page.locator('#screen-connect:visible').count(),0,'seeded station must not show the connect screen');
      assert.doesNotMatch(await page.title(),/StarNet/i);
      assert.equal(await page.locator('#model-dock-subscription:visible').count(),0,'no Starnet subscription link');
      if(name==='desktop'){
        await page.waitForFunction(()=>typeof World!=='undefined' && World.stationDoc());
        const originalRooms=await page.evaluate(()=>Object.values(World.stationDoc().rooms).map(room=>room.name).sort());
        assert.ok(originalRooms.length>0,'the fixture has an original floor to restore');
        await page.evaluate(()=>document.querySelector('#bb-build').click());
        await page.locator('#refit-stations').click();
        const presets=page.getByRole('dialog',{name:'Station presets',exact:true});
        await presets.locator('[data-station-build="ultra-command"]').click();
        await presets.locator('[data-use-build]').click();
        assert.match(await presets.locator('[data-use-build]').innerText(),/CONFIRM/,'the first click arms the preset');
        assert.deepEqual(await page.evaluate(()=>Object.values(World.stationDoc().rooms).map(room=>room.name).sort()),originalRooms,'arming leaves the floor unchanged');
        await presets.locator('[data-use-build]').click();
        await presets.waitFor({state:'hidden'});
        assert.deepEqual(await page.evaluate(()=>Object.values(World.stationDoc().rooms).filter(room=>room.kind!=='corridor').map(room=>room.name).sort()),['CAMPAIGN','COMMAND'],'1ULTRA COMMAND replaces the floor (hallways aside)');
        for(const [id,role] of [['research','Research'],['delivery','Delivery'],['sales','Sales'],['qa','QA']]){
          assert.match(await page.locator('#crew .crew-row[data-agent-id="'+id+'"] .crew-name').innerText(),new RegExp('\\b'+role+'\\b'),'the '+role+' crew row remains');
        }
        await page.locator('#refit-done').click();
        await page.waitForTimeout(1500);   // let the floor bake and the crew walk to their desks before the picture
        await page.screenshot({path:path.join(out,'starnet-command-layout.png')});
        await page.evaluate(()=>document.querySelector('#bb-build').click());
        await page.locator('#refit-stations').click();
        await presets.locator('[data-restore-build]').click();
        await presets.waitFor({state:'hidden'});
        assert.deepEqual(await page.evaluate(()=>Object.values(World.stationDoc().rooms).map(room=>room.name).sort()),originalRooms,'RESTORE PREVIOUS restores the fixture room names');
        await page.locator('#refit-done').click();
      }
      await page.evaluate(()=>document.querySelector('.bb[data-term="leads"]').click());
      await page.waitForSelector('.ultra-leads .ul-row');
      assert.ok(await page.locator('.ultra-leads .ul-row').count()>=1,'LEADS lists companies');
      await page.locator('.ultra-leads .ul-row').first().click();
      await page.waitForSelector('.ultra-leads .ul-card h3');
      assert.ok((await page.locator('.ultra-leads .ul-card').innerText()).length>40,'the company card shows its facts');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal scroll');
      assert.equal(await page.locator('.ultra-leads iframe').count(),0,'LEADS is native, not a framed page');
      await waitForWindowShown(page,'.ultra-leads-win');
      await page.screenshot({path:path.join(out,'starnet-leads-'+name+'.png')});
      await page.locator('.ultra-leads [data-ul-action="outreach"]').click();
      await page.locator('#chat-input').waitFor({state:'visible'});
      assert.match(await page.locator('#chat-input').inputValue(),/campaign\.lead/,'Ask ULTRA prepares the composer');
      await page.locator('.ultra-leads-win').waitFor({state:'hidden'});
      assert.equal(await page.locator('.ultra-leads-win').isVisible(),false,'LEADS no longer covers COMMS');
      await page.getByRole('button',{name:'‹ BACK TO LEADS',exact:true}).click();
      await waitForWindowShown(page,'.ultra-leads-win');
      await page.locator('.ultra-leads [data-tab="proposed"]').click();
      await page.waitForSelector('.ultra-leads .ul-proposed');
      await page.evaluate(()=>document.querySelector('.bb[data-term="ultra-room-templates"]').click());
      await page.waitForSelector('.ultra-rt-row');
      assert.ok(await page.locator('.ultra-rt-row').count()>=6,'the six 1Ultra room templates are listed');
      assert.match(await page.locator('.ultra-rt').innerText(),/1ULTRA COMMAND/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'ROOM TEMPLATES has no horizontal scroll');
      await waitForWindowShown(page,'.ultra-room-templates-win');
      await page.screenshot({path:path.join(out,'starnet-room-templates-'+name+'.png')});
      await page.locator('.ultra-room-templates-win .term-x').click();
      await page.waitForSelector('.ultra-rt',{state:'hidden'});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'PROPOSED has no horizontal scroll');
      await waitForWindowShown(page,'.ultra-leads-win');
      await page.screenshot({path:path.join(out,'starnet-proposed-'+name+'.png')});
      await page.getByRole('link',{name:'Classic campaign page'}).click();
      const frame=page.frameLocator('.ultra-frame');await frame.locator('#lead-list').waitFor({timeout:20000});
      assert.ok(await frame.locator('#lead-list').innerText().then(t=>t.length>20),'classic campaign lead list rendered inside the window');
      await waitForWindowShown(page,'.ultra-campaign-win');
      await page.screenshot({path:path.join(out,'starnet-campaign-'+name+'.png')});
      await page.evaluate(()=>document.querySelector('.bb[data-term="ultra-switches"]').click());
      await page.waitForSelector('.ultra-sw-row');
      assert.equal(await page.locator('[data-switch="tools.browser"]').isDisabled(),true);
      assert.equal(await page.locator('[data-switch="crew.freellmapi"]').isDisabled(),false);
      assert.equal(await page.locator('[data-switch="lead.codex"]').isDisabled(),false);
      await page.locator('.ultra-crew-status').waitFor();
      await page.waitForFunction(() => {
        const line=document.querySelector('.ultra-crew-status');
        return line && line.textContent !== 'FreeLLMAPI: checking…';
      });
      const crewStatus=await page.locator('.ultra-crew-status').textContent();
      assert.match(crewStatus,/^FreeLLMAPI:/);
      assert.notEqual(crewStatus,'FreeLLMAPI: checking…');
      assert.equal(await page.locator('[data-switch="concurrency"]').isDisabled(),false);
      assert.match(await page.locator('.ultra-credit').innerText(),/not affiliated/);
      await waitForWindowShown(page,'.ultra-switches-win');
      await page.screenshot({path:path.join(out,'starnet-switches-'+name+'.png')});
      assert.deepEqual(external,[],'no external requests');
      assert.deepEqual(errors,[],'no uncaught page errors');
      await page.close();
    }
    console.log('starnet browser journey passed at desktop and 390px');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

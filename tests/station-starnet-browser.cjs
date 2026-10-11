const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.ULTRA_PLAYWRIGHT_MODULE);
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
      await page.evaluate(()=>document.querySelector('.bb[data-term="campaign"]').click());
      const frame=page.frameLocator('.ultra-frame');await frame.locator('#lead-list').waitFor({timeout:20000});
      assert.ok(await frame.locator('#lead-list').innerText().then(t=>t.length>20),'campaign lead list rendered inside the window');
      await page.screenshot({path:path.join(out,'starnet-campaign-'+name+'.png')});
      await page.evaluate(()=>document.querySelector('.bb[data-term="ultra-switches"]').click());
      await page.waitForSelector('.ultra-sw-row');
      assert.equal(await page.locator('[data-switch="tools.browser"]').isDisabled(),true);
      assert.equal(await page.locator('[data-switch="crew.freellmapi"]').isDisabled(),false);
      assert.equal(await page.locator('[data-switch="lead.codex"]').isDisabled(),false);
      await page.locator('.ultra-crew-status').waitFor();
      assert.match(await page.locator('.ultra-crew-status').textContent(),/FreeLLMAPI:/);
      assert.equal(await page.locator('[data-switch="concurrency"]').isDisabled(),false);
      assert.match(await page.locator('.ultra-credit').innerText(),/not affiliated/);
      await page.screenshot({path:path.join(out,'starnet-switches-'+name+'.png')});
      assert.deepEqual(external,[],'no external requests');
      assert.deepEqual(errors,[],'no uncaught page errors');
      await page.close();
    }
    console.log('starnet browser journey passed at desktop and 390px');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

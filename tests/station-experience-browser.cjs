// Invoked by scripts/station_browser_smoke.py against a temporary copied-record
// station only. Uses an already installed Playwright/browser; never downloads one.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.ULTRA_PLAYWRIGHT_MODULE);
async function main(){
  assert.equal(process.env.ULTRA_BROWSER_FIXTURE,'copied-records');
  const base=process.env.ULTRA_BROWSER_BASE,out=process.env.ULTRA_BROWSER_OUTPUT;
  assert.match(base,/^http:\/\/127\.0\.0\.1:855[0-9]$/);
  const browser=await chromium.launch({executablePath:process.env.ULTRA_BROWSER_EXECUTABLE,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],external=[],checks=[];
  let expectingRefusal=false,expectedHttpRefusals=0;
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'){if(expectingRefusal&&/status of 400/.test(message.text()))expectedHttpRefusals++;else errors.push(message.text());}});
  page.on('request',request=>{if(!request.url().startsWith(base+'/'))external.push(request.url());});
  const nav=async tab=>{await page.locator(`#nav [data-tab="${tab}"]`).click();await page.waitForFunction(tab=>document.querySelector('#page-title').textContent.toLowerCase()===tab,tab);};
  const request=(route,body)=>page.evaluate(async({route,body})=>api(route,body),{route,body});
  try{
    await page.goto(base+'/campaign/');await page.waitForSelector('#station-floor');
    const initialWorkspace=await request('workspace'),initialCampaign=await request('campaign');
    assert.equal(await page.locator('#back').isDisabled(),true);
    assert.equal(await page.locator('#command-dock button').count(),6);
    assert.equal(await page.locator('#crew-rail .crew-key').count(),4);
    await page.screenshot({path:path.join(out,'station-desktop.png'),fullPage:true,animations:'disabled'});checks.push('Station landing, command deck and crew rail');
    const firstRoom=await page.locator('#room-select').inputValue(),otherRoom=await page.locator('#room-select option').nth(1).getAttribute('value');
    await page.locator('#room-select').selectOption(otherRoom);await page.locator('#back').click();await page.waitForFunction(id=>document.querySelector('#room-select')?.value===id,firstRoom);

    await page.locator('[data-action="open-campaign"]').click();
    const original=await page.locator('.lead-card.active').getAttribute('data-lead');
    const alternate=await page.locator('.lead-card:not(.active)').first().getAttribute('data-lead');
    await page.locator(`[data-lead="${alternate}"]`).click();await page.locator('#back').click();
    await page.waitForFunction(id=>document.querySelector('.lead-card.active')?.dataset.lead===id,original);
    await page.locator('#back').click();await page.waitForSelector('#station-floor');
    await nav('campaign');await nav('recipes');await page.reload();await page.waitForSelector('#recipe-list');
    await page.locator('#back').click();await page.waitForSelector('#lead-list');
    await page.goBack();await page.waitForSelector('#station-floor');checks.push('App and browser Back preserve company context through refresh');

    await nav('campaign');await page.locator('[data-action="apollo"]').click();await page.locator('#apollo-csv').fill('Company Name,Company Country,Email\nExample,Tunisia,info@example.tn');
    await page.locator('#modal-back').click();assert.equal(await page.locator('#modal').evaluate(el=>el.open),false);
    assert.equal(await page.locator('#page-title').textContent(),'Campaign');checks.push('Popup Back returns to its work area');

    await nav('recipes');
    let release;const held=new Promise(resolve=>{release=resolve;});
    await page.route('**/api/ultra/jobs',async route=>{await held;await route.continue();});
    await page.locator('[data-action="typed-script:validate-records"]').click();
    await page.waitForSelector('#run-strip progress:not([value])');
    assert.equal(await page.locator('[data-action="typed-script:validate-records"]').isDisabled(),true);
    assert.equal(await page.locator('#modal').evaluate(el=>el.open),false,'One click starts the script without opening its source or an empty form');
    await page.locator('#run-strip [data-action="runs"]').click();
    assert.equal(await page.locator('#modal-progress').isVisible(),true);
    await page.screenshot({path:path.join(out,'task-starting.png'),animations:'disabled'});
    await page.locator('#modal-back').click();
    release();
    await page.waitForFunction(()=>R.jobs.some(j=>j.tool==='validate-records'&&j.status==='prepared'));
    await page.unroute('**/api/ultra/jobs');
    await page.locator('#run-strip [data-action="runs"]').click();
    await page.waitForSelector('#runs-list .run-card.good progress[value="100"]');
    await page.locator('#runs-list [data-action^="artifact:"]').first().click();await page.waitForSelector('#modal-body pre');
    await page.locator('#modal-back').click();await page.waitForSelector('#runs-list');
    await page.locator('#modal-back').click();assert.equal(await page.locator('#modal').evaluate(el=>el.open),false);
    checks.push('Immediate indeterminate task progress, duplicate-submit guard and actual result');
    checks.push('Nested output dialog Back restores the run console');

    await nav('workflows');await page.locator('[data-action="new-workflow"]').click();await page.locator('#flow-name').fill('BROWSER FIXTURE audit and review');
    // Exercise passed-script progress with valid records; lead freshness warnings must still block real audits.
    await page.locator('#node-tool-0').selectOption('validate-records');await page.locator('#node-desk-0').selectOption('qa');
    await page.locator('[data-action="flow-save"]').click();
    await page.waitForFunction(()=>R.state.workflows?.some(f=>f.name==='BROWSER FIXTURE audit and review'));
    const flowId=await page.evaluate(()=>R.state.workflows.find(f=>f.name==='BROWSER FIXTURE audit and review').id);
    await page.locator(`[data-action="workflow-step:${flowId}"]`).click();
    await page.waitForFunction(id=>R.state.workflowRuns?.[id]?.completed.includes('audit'),flowId);
    await page.waitForFunction(()=>document.querySelector('.workflow-meter')?.textContent.includes('25%'));
    assert.match(await page.locator('.workflow-meter').first().textContent(),/25%/);
    await page.locator(`[data-action="workflow-step:${flowId}"]`).click();await page.locator(`[data-action="confirm-step:${flowId}"]`).click();
    await page.waitForFunction(id=>R.state.workflowRuns?.[id]?.checkpoints.includes('source_review'),flowId);
    await page.waitForFunction(()=>document.querySelector('.workflow-meter')?.textContent.includes('50%'));
    assert.match(await page.locator('.workflow-meter').first().textContent(),/50%/);
    await page.locator(`[data-action="edit-workflow:${flowId}"]`).click();await page.locator('#node-label-0').fill('Changed audit step');await page.locator('[data-action="flow-save"]').click();
    await page.waitForFunction(()=>document.querySelector('.workflow-meter')?.textContent.includes('0%'));
    checks.push('Workflow percentage follows script receipts and owner checkpoints; edits reset stale progress');

    const result=await request('jobs',{desk:'delivery',tool:'scope-check',params:{}});
    await page.waitForFunction(id=>R.jobs.some(j=>j.id===id&&j.status==='needs_review'),result.id);
    await page.locator('#run-strip [data-action="runs"]').click();
    const review=page.locator(`#runs-list [data-job="${result.id}"]`);
    await review.waitFor();assert.match(await review.textContent(),/Review required/);assert.match(await review.textContent(),/resolve its checks/);
    await page.locator('#modal-back').click();checks.push('Finished scripts with missing inputs retain Review required');

    await page.locator('#stop').click();await page.waitForFunction(()=>R.halted);
    await nav('recipes');expectingRefusal=true;await page.locator('[data-action="typed-script:validate-records"]').click();
    await page.waitForFunction(()=>launchError?.launchOnly&&launchError.status==='failed');
    expectingRefusal=false;
    await page.locator('#run-strip [data-action="runs"]').click();
    const refused=page.locator('#runs-list .run-card.error').first();assert.match(await refused.textContent(),/Launch failed/);assert.equal(await refused.locator('progress').getAttribute('value'),'0');
    await page.locator('#modal-back').click();await nav('settings');await page.locator('[data-action="resume"]').click();await page.waitForFunction(()=>!R.halted);
    checks.push('Stopped launches show a failure with zero completion');

    for(const tab of ['campaign','station','sessions','tasks','workflows','recipes','crew','memory','outbox','settings']){await nav(tab);assert.ok((await page.locator('#content').textContent()).length>100);}
    checks.push('All ten sections remain usable');
    for(const [width,height] of [[1024,900],[390,844]]){
      await page.setViewportSize({width,height});
      if(width<700)await page.locator('#menu').click();await nav('station');
      assert.ok(await page.locator('#station-floor').isVisible());
      assert.ok(await page.locator('#command-dock').isVisible());
      assert.ok(await page.locator('#back').isVisible());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(width<700)await page.waitForFunction(()=>document.querySelector('.rail').getBoundingClientRect().right<=0);
      await page.waitForFunction(()=>!document.querySelector('#toast').classList.contains('show'));
      await page.screenshot({path:path.join(out,`station-${width}.png`),fullPage:true,animations:'disabled'});
    }
    await page.locator('#command-dock [data-tab="tasks"]').click();assert.equal(await page.locator('#page-title').textContent(),'Tasks');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push('Tablet/mobile command deck, Back and quests without page overflow');
    const workspace=await request('workspace');assert.equal(workspace.progression.xp,initialWorkspace.progression.xp);assert.equal(workspace.hunt.leads.length,initialWorkspace.hunt.leads.length);
    assert.equal((await request('campaign')).analytics.counts.contacted,initialCampaign.analytics.counts.contacted);checks.push('Fixture preparation leaves real campaign stages and XP unchanged');
    await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/classic/#workshop');await page.waitForSelector('#tool-form');
    await page.locator('[data-tool="validate-records"]').click();
    let releaseClassic;const classicHeld=new Promise(resolve=>{releaseClassic=resolve;});
    await page.route('**/api/ultra/automate',async route=>{await classicHeld;await route.continue();});
    const completed=page.waitForResponse(response=>response.url()===base+'/api/ultra/automate'&&response.request().method()==='POST');
    await page.locator('[data-run-script="validate-records"]').click();
    await page.waitForSelector('#workshop-result [data-execution="running"] progress:not([value])');
    assert.equal(await page.locator('[data-run-script="validate-records"]').isDisabled(),true);
    await page.screenshot({path:path.join(out,'classic-running.png'),animations:'disabled'});releaseClassic();
    const classicResponse=await completed;assert.equal(classicResponse.status(),200);const classicResult=await classicResponse.json();
    await page.unroute('**/api/ultra/automate');
    assert.equal(classicResult.run.automation,'validate-records');assert.ok(classicResult.run.files.some(file=>file.endsWith('/report.md')));
    await page.waitForSelector('#workshop-result [data-artifact]');assert.match(await page.locator('#workshop-result').textContent(),new RegExp(classicResult.run.id));
    assert.equal(await page.locator('#artifact-dialog').evaluate(el=>el.open),false,'Running keeps the workshop visible and separates opening a saved result');
    await page.screenshot({path:path.join(out,'classic-completed.png'),animations:'disabled'});
    await page.locator('#workshop-result [data-artifact]').first().click();await page.waitForSelector('#artifact-dialog[open]');assert.match(await page.locator('#artifact-meta').textContent(),/runs\//);
    checks.push('Classic Run script executes Python, shows its saved result, and opens output only on request');
    await page.locator('#close-artifact').click();
    const classicControl=action=>page.evaluate(async action=>{const response=await fetch('/api/ultra/control',{method:'POST',headers:{'Content-Type':'application/json','X-Starnet-Token':window.__STARNET_API_TOKEN__},body:JSON.stringify({action})});if(!response.ok)throw Error('Fixture control failed');},action);
    await classicControl('stop');expectingRefusal=true;await page.locator('[data-run-script="validate-records"]').click();
    await page.waitForSelector('#workshop-result [data-execution="failed"] progress[value="0"]');expectingRefusal=false;
    assert.match(await page.locator('#workshop-result').textContent(),/Emergency stop/);assert.equal(await page.locator('#workshop-result [data-artifact]').count(),0);
    await classicControl('resume');checks.push('Classic failures show the actual error and zero completion');
    await page.setViewportSize({width:390,height:844});await page.locator('#workshop-result').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'classic-mobile.png'),fullPage:true,animations:'disabled'});
    checks.push('Classic execution summary remains usable at 390px');
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    console.log(JSON.stringify({checks,passed:checks.length,console_errors:errors.length,expected_http_refusals:expectedHttpRefusals,external_requests:external.length,screenshots:out},null,2));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

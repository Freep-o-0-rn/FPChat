'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const baselinePath=path.resolve(process.env.FPCHAT_ITEM14_SUMMARY||'');
const currentPath=path.resolve(process.env.FPCHAT_ITEM15_SUMMARY||'');
const outputPath=path.resolve(process.env.FPCHAT_ITEM15_COMPARE_OUTPUT||'next15-controlled-comparison.json');

if(!process.env.FPCHAT_ITEM14_SUMMARY||!process.env.FPCHAT_ITEM15_SUMMARY){
  throw new Error('FPCHAT_ITEM14_SUMMARY and FPCHAT_ITEM15_SUMMARY are required');
}

const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
const current=JSON.parse(fs.readFileSync(currentPath,'utf8'));

assert.equal(baseline.fixture?.sha256,current.fixture?.sha256,'fixture hash changed between item14/item15');
assert.equal(baseline.fixture?.bytes,current.fixture?.bytes,'fixture size changed between item14/item15');
assert.equal(baseline.fixture?.width,current.fixture?.width,'fixture width changed');
assert.equal(baseline.fixture?.height,current.fixture?.height,'fixture height changed');

const round=value=>Math.round(Number(value)*10)/10;
const states=['managedWarm','managedMissHttpRetained','managedMissHttpCold'];
const profiles=['normal','throttled'];
const result={
  schema:1,
  purpose:'same-run item14 vs item15 viewer timing comparison',
  baseline:{
    commit:process.env.FPCHAT_ITEM14_COMMIT||null,
    runtimeSha:baseline.runtimeSha||baseline.runtimeBaselineSha||null,
    measurementHead:baseline.measurementHead||baseline.measurementHarnessSha||null
  },
  current:{
    commit:process.env.FPCHAT_ITEM15_COMMIT||null,
    runtimeSha:current.runtimeSha||null,
    measurementHead:current.measurementHead||null
  },
  fixture:{
    width:current.fixture.width,
    height:current.fixture.height,
    bytes:current.fixture.bytes,
    sha256:current.fixture.sha256
  },
  environment:{
    baseline:baseline.environment,
    current:current.environment
  },
  results:{},
  notes:[
    'Both benchmarks were executed sequentially in the same GitHub Actions job/runner with the same Playwright installation.',
    'Item 14 has no viewer-preview metric because the old viewer showed only a loading indicator until original readiness.',
    'The item15 viewer-preview metric starts at the same media-tile click boundary as item14 originalReadyMs.',
    'DOM readiness/decode measurements are not hardware-presentation timestamps.'
  ]
};

for(const profile of profiles){
  result.results[profile]={};
  for(const state of states){
    const key=profile+'.'+state;
    const oldSummary=baseline.summary?.[key];
    const newSummary=current.summary?.[key];
    assert(oldSummary&&newSummary,'missing comparison scenario '+key);

    const oldOriginal=Number(oldSummary.originalReadyMs?.median);
    const newPreview=Number(newSummary.viewerPreviewReadyMs?.median);
    const newOriginal=Number(newSummary.originalReadyMs?.median);
    assert(Number.isFinite(oldOriginal)&&Number.isFinite(newPreview)&&Number.isFinite(newOriginal),'invalid medians '+key);

    result.results[profile][state]={
      item14OriginalMedianMs:oldOriginal,
      item15ViewerPreviewMedianMs:newPreview,
      item15OriginalMedianMs:newOriginal,
      viewerPreviewEarlierThanOldOriginalMs:round(oldOriginal-newPreview),
      viewerPreviewEarlierThanCurrentOriginalMs:round(newOriginal-newPreview),
      item15OriginalDeltaVsItem14Ms:round(newOriginal-oldOriginal),
      item15OriginalDeltaVsItem14Pct:oldOriginal?round((newOriginal-oldOriginal)/oldOriginal*100):null
    };
  }
}

fs.mkdirSync(path.dirname(outputPath),{recursive:true});
fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
console.log('NEXT15_CONTROLLED_COMPARISON '+JSON.stringify(result));

'use strict';
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const scripts=[
 'regression179-explicit-block-stores.cjs',
 'regression179-explicit-participant-presence.cjs',
 'regression179-explicit-presence-broadcaster.cjs',
 'regression179-explicit-text-block-guard.cjs',
 'regression179-explicit-legacy-media-block-guard.cjs',
 'regression179-explicit-media-upload-block-guard.cjs',
 'regression179-explicit-invite-block-guard.cjs',
 'regression179-explicit-message-actions.cjs',
 'regression179-explicit-message-pins.cjs',
 'regression179-explicit-installers.cjs',
 'regression179-final-composition.cjs'
];
for(const script of scripts)execFileSync(process.execPath,[path.join(__dirname,script)],{cwd:root,stdio:'inherit'});
console.log('PASS Build 179.4 complete item-by-item explicit composition acceptance');

# External Trial Checklist

Trial channel baseline: `0.1.0-trial.1`

## Tester Profile

- Machine owner:
- Windows version:
- Admin rights available: `yes / no`
- Kimi CLI already installed: `yes / no`
- Browser to test: `Edge / Chrome / both / none`
- Office to test: `Word / Excel / PowerPoint / none`

## Install Pass

1. Open the trial bundle directory.
2. Run `Check LingxY Desktop Trial.cmd`.
3. Record any prerequisite failures or warnings.
4. Run `Setup LingxY Desktop Trial.cmd`.
5. Record any SmartScreen / Defender / permission prompts.
6. Confirm the desktop shell launches.

## Core Desktop Pass

1. Confirm the desktop window opens without using a browser tab.
2. Confirm the runtime is healthy after launch.
3. Close the desktop shell and relaunch it once.
4. Confirm relaunch succeeds.

## File Entry Pass

1. Right-click a local file.
2. Confirm the LingxY entry appears.
3. Trigger the entry.
4. Confirm a desktop prompt / input surface appears.
5. Enter a short instruction.
6. Submit and verify a task completes.
7. Confirm a report artifact is produced.

## Browser Pass

1. Install the native host if needed.
2. Sideload the browser extension in a clean profile.
3. Select text on a webpage.
4. Confirm the selection entry / chip appears.
5. Submit a task and verify it reaches the desktop runtime.

## Office Pass

1. Sideload one Office add-in manifest.
2. Open the task pane.
3. Select content in the document.
4. Submit to LingxY.
5. Record whether the selection reaches the runtime.

## Risk Capture

- SmartScreen result:
- Defender result:
- Permission prompts shown:
- Any unsigned binary warnings:
- Any blocked scripts:

## Outcome

- Fresh install result: `pass / partial / fail`
- User interaction smoke result: `pass / partial / fail`
- Provider smoke result: `pass / partial / fail`
- Browser sideload result: `pass / partial / fail`
- Office sideload result: `pass / partial / fail`
- Explorer entry result: `pass / partial / fail`
- Scheduler result: `pass / partial / fail`
- Side-effect approval result: `pass / partial / fail`
- Artifact quality result: `pass / partial / fail`
- MCP/skills result: `pass / partial / fail`
- Packaging result: `pass / partial / fail`
- Recovery result: `pass / partial / fail`
- Recommended next action:

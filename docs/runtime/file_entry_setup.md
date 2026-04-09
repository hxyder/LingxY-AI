# File Entry Setup

## Explorer Entry Strategy

- Win10/Win11: registry command launches `UcaExplorerSelectionHelper`
- helper batches concurrent Explorer invocations and opens the desktop overlay prompt
- Win11 main promoted path remains the fixed overlay and console shell

## Multi-Select Behavior

- Explorer may launch one process per selected file
- `UcaExplorerSelectionHelper` batches concurrent launches into one handoff window
- the owner instance opens one overlay prompt with the merged file list
- the user fills the requirement inside the overlay, then the overlay submits the task

## Helper Boundary

`src/helper/explorer_selection/selection-contract.mjs` is the stable payload contract for the native helper and overlay handoff.

## Installation

- Run `scripts/install-explorer-entry.ps1`
- The script publishes `UcaExplorerSelectionHelper` under `%LOCALAPPDATA%/UCA/helper/explorer-selection`
- Explorer right-click currently registers under `HKCU\Software\Classes\*\shell\UCA.Analyze`
- Right-click now targets the desktop overlay prompt instead of direct CLI submission

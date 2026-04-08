# File Entry Setup

## Explorer Entry Strategy

- Win10/Win11 MVP: registry command launches `uca-cli`
- Win11 main promoted path: `Ctrl+Shift+E`

## Multi-Select Behavior

- Explorer may launch one process per selected file
- `uca-cli` batches concurrent launches into one `file_group`
- the owner instance performs the final service submission

## Helper Boundary

`src/helper/explorer_selection/selection-contract.mjs` is the stable payload contract for the native helper.

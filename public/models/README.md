# Avatar Models (GLB)

This folder holds the 3D avatar models for the Office 3D view.
Each file is named after the agent's workspace ID (e.g. `main.glb`, `studio.glb`).

## How to add your own models

1. Go to https://readyplayer.me/avatar and create an avatar
2. Export as **GLB**
3. Rename the file to match your agent's workspace ID (see `agentsConfig.ts`)
4. Place it in this folder

## Fallback

If a GLB file is not found for an agent, the system displays a colored sphere as placeholder.

## Recommended format

- **Format:** GLB (binary GLTF)
- **Max size:** < 5 MB per model
- Ready Player Me exports web-optimized models by default

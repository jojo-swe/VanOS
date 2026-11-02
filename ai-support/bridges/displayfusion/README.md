# DisplayFusion bridge (Windows)

Runs on your PC. VanOS POSTs here over Tailscale; the bridge executes DisplayFusion functions.

1. Copy `VanOS-DisplayFusion-Bridge.ps1` to the PC  
2. Match secret with Mission Control `DISPLAYFUSION_BRIDGE_SECRET`  
3. Start the script (see `HOME-LAB.md`)  
4. Set `DISPLAYFUSION_BRIDGE_URL=http://<pc-tailscale-name>:17890/run`

Create named Functions inside DisplayFusion Settings → Functions, then point `DISPLAYFUSION_SCRIPTS_JSON` `command` fields at those function names.

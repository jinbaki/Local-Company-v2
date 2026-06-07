# Demo Data

This folder is the default target for the demo seed script.

Run:

```bash
npm run seed:demo
```

Then start the app with `DATA_DIR` pointing to this folder.

On PowerShell:

```powershell
$env:DATA_DIR = ".\data-sample"
npm run dev
```

SQLite files generated in this folder are local runtime artifacts and are ignored by `.gitignore`.

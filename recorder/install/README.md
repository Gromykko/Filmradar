# Rularea recorder-ului la pornirea sistemului

`recorder/record.mjs --watch` trebuie să ruleze tot timpul pe o mașină care
stă pornită (VPS sau un PC de acasă) — GitHub Actions NU e potrivit, rulările
lui sunt scurte și ar fi omorâte în mijlocul unui film.

Ai nevoie de: Node.js 20+ și `ffmpeg` pe PATH. Verifică cu `node -v` și
`ffmpeg -version`.

## Linux (VPS) — systemd

1. Clonează/copiază proiectul pe server, de exemplu în `/home/filmradar/tunuldelemn`.
2. Editează `filmradar-recorder.service` din acest folder: pune calea reală în
   `WorkingDirectory`, utilizatorul în `User`, și opțional token-ul Telegram.
3. Copiază-l și pornește-l:

   ```bash
   sudo cp recorder/install/filmradar-recorder.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now filmradar-recorder
   ```

4. Verifică starea și jurnalele:

   ```bash
   systemctl status filmradar-recorder
   journalctl -u filmradar-recorder -f
   ```

5. Pentru actualizări: `git pull`, apoi `sudo systemctl restart filmradar-recorder`.

Oprirea (`systemctl stop`) trimite SIGINT — record.mjs închide ffmpeg curat
(scrie trailerul mp4-ului) înainte de a ieși, deci nu rămân fișiere corupte.

## Windows — Task Scheduler

Pe un PC Windows care rămâne pornit, folosește Task Scheduler ca să pornească
recorder-ul automat la boot/login, fără să fie nevoie să deschizi manual un
terminal:

```powershell
schtasks /create /tn "Filmradar Recorder" ^
  /tr "node.exe C:\path\catre\tunuldelemn\recorder\record.mjs --watch --ics --notify --outdir C:\Filmradar\recordings" ^
  /sc onlogon /rl highest
```

Note:

- Înlocuiește calea din `/tr` cu calea reală unde ai clonat proiectul.
- `/sc onlogon` pornește task-ul când te loghezi; pentru un server fără
  utilizator logat permanent, folosește `/sc onstart` (rulează la pornirea
  Windows, necesită drepturi de admin) în loc de `onlogon`.
- Verifică task-ul creat: `schtasks /query /tn "Filmradar Recorder" /v /fo list`.
- Șterge-l cu: `schtasks /delete /tn "Filmradar Recorder" /f`.
- Ferestrele PowerShell/CMD deschise de Task Scheduler pot rămâne ascunse —
  urmărește progresul din fișierele scrise în `--outdir`, sau adaugă
  `--notify` cu un bot Telegram ca să primești mesaje de start/final.

## Ambele platforme

- Nu trebuie completat nimic manual în `recorder/streams.json` — fluxurile se
  rezolvă automat la pornire și înainte de fiecare înregistrare
  (`scraper/lib/streams.mjs`). Fișierul json e doar un cache de rezervă.
- Pentru un test rapid fără să aștepți programarea: `node recorder/record.mjs
  --now moldova-2 --mins 2 --dry-run` (afișează comanda ffmpeg fără să
  înregistreze).
- `--vlc` deschide fluxul live într-un player local când începe o
  înregistrare — util doar pe o mașină cu monitor, nu pe un VPS headless.

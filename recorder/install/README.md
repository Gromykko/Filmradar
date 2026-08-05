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

Notă:

- Înlocuiește calea din `/tr` cu calea reală unde ai copiat proiectul.
- `/sc onlogon` pornește sarcina când te loghezi; pentru un server fără
  utilizator logat permanent, folosește `/sc onstart` (rulează la pornirea
  Windows, necesită drepturi de administrator) în loc de `onlogon`.
- Verifică sarcina creată: `schtasks /query /tn "Filmradar Recorder" /v /fo list`.
- Șterge-o cu: `schtasks /delete /tn "Filmradar Recorder" /f`.

### Trei lucruri care strică o instalare altfel corectă

Fără ele pare că merge, și tace exact când conta.

**1. Windows oprește sarcina după 72 de ore.** E valoarea implicită în Task
Scheduler, iar `--watch` e menit să ruleze la nesfârșit. După trei zile se
oprește fără eroare, fără repornire, fără nimic în jurnal. Dezactiveaz-o:

```powershell
$t = Get-ScheduledTask -TaskName "Filmradar Recorder"
$t.Settings.ExecutionTimeLimit = "PT0S"    # fără limită de timp
$t.Settings.RestartCount = 999
$t.Settings.RestartInterval = "PT1M"       # repornește la un minut după o eroare
Set-ScheduledTask -InputObject $t
```

Pe laptop, debifează și „Pornește sarcina doar dacă alimentarea e la rețea"
din fila *Conditions*.

**2. Nu vezi niciun mesaj.** Fereastra deschisă de Task Scheduler e ascunsă,
deci fiecare linie de jurnal și fiecare eroare a ffmpeg dispar. Scrie-le
într-un fișier — altfel o difuzare sărită („nu am niciun flux pentru
canal") e complet invizibilă:

```
/tr "cmd.exe /c node.exe C:\cale\catre\proiect\recorder\record.mjs --watch --maybes --outdir C:\Filmradar\recordings >> C:\Filmradar\recorder.log 2>&1"
```

`--notify` prin Telegram ajută, dar nu înlocuiește jurnalul: te anunță doar
la începutul și sfârșitul unei înregistrări, nu și atunci când una a fost
sărită complet.

**3. Calculatorul adoarme.** Un film la 08:30 e exact ora la care Windows a
intrat demult în somn, iar înregistrarea moare acolo. Reconectarea din
ffmpeg acoperă întreruperi de rețea de câteva secunde, nu o suspendare a
sistemului:

```
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

Ecranul poate să se stingă liniștit, nu contează. Revii oricând cu
`powercfg /change standby-timeout-ac 30`.

De reținut: nu există recuperare pentru o difuzare ratată. Dacă programul nu
rula la ora respectivă, filmul e pierdut — sarcina programată e singura
plasă de siguranță.

## Ambele platforme

- Nu trebuie completat nimic manual în `recorder/streams.json` — fluxurile se
  rezolvă automat la pornire și înainte de fiecare înregistrare
  (`scraper/lib/streams.mjs`). Fișierul json e doar un cache de rezervă.
- Pentru un test rapid fără să aștepți programarea: `node recorder/record.mjs
  --now moldova-2 --mins 2 --dry-run` (afișează comanda ffmpeg fără să
  înregistreze).
- `--vlc` deschide fluxul live într-un player local când începe o
  înregistrare — util doar pe o mașină cu monitor, nu pe un VPS headless.

## Captură redundantă, fără proiect: `capture.sh`

`record.mjs` e calea bună pe o mașină care are proiectul. `capture.sh` din
acest folder e pentru redundanță: un singur fișier care are nevoie doar de
`sh`, `curl` și `ffmpeg`. Îl copiezi pe un NAS, pe un laptop împrumutat sau pe
telefon (Termux) și îl rulezi. O difuzare care poate să nu se repete ani de
zile nu trebuie să depindă de o singură mașină.

```sh
./capture.sh 2026-08-08 22:00 105 /volume1/video/tunul-de-lemn.mp4
#            <dată>     <oră>  <min> <fișier>          [<pagina canalului>]
```

**Ora e ÎNTOTDEAUNA ora Chișinăului** — aceeași pe care o scrie TRM în grilă.
Scriptul o convertește singur la ceasul mașinii pe care rulează, deci dai
22:00 fie că ești în Chișinău, în Copenhaga sau oriunde altundeva. Dacă îl
pornești după ora de start, începe imediat și prinde restul filmului.

Rezolvă adresa fluxului la fiecare rulare, niciodată din fișier. TRM a
schimbat deja și gazda și id-ul (`v0.trm.md/d5fafab0` → `v.trm.md/937e4e0e`),
iar o adresă veche poate în continuare să difuzeze ALT canal — ai obține o
înregistrare curată a emisiunii greșite și ai afla abia la vizionare.

### Synology (DSM 7)

DSM nu are `ffmpeg` în PATH. Cel mai sigur e prin Container Manager:

```sh
# rezolvi fluxul pe NAS, înregistrezi în container
docker run --rm -v /volume1/video:/out linuxserver/ffmpeg \
  -user_agent "Mozilla/5.0" -reconnect 1 -reconnect_streamed 1 \
  -reconnect_delay_max 30 -i "<adresa m3u8>" -t 6300 \
  -c copy -bsf:a aac_adtstoasc -movflags +faststart -y /out/tunul-de-lemn.mp4
```

Programează-l din **Control Panel → Task Scheduler → Scheduled Task**, ca
`root`, la data și ora dorite. Verifică ÎNAINTE cu o probă de 60 de secunde —
`-t 60` — și deschide fișierul. Un NAS în Moldova e cea mai bună poziție:
fără restricții geografice și cel mai scurt drum până la TRM.

### Spațiu

~32 MB/minut la 1080p, copiere directă fără recodare. 105 minute ≈ 3,4 GB.

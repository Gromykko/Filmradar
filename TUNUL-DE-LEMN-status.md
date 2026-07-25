# „Tunul de lemn" (Moldova-Film, 1986/87) — where to find the restored version

**Film:** Tunul de lemn / The Wooden Cannon · dir. Vasile Brescanu · scr. Nicolae Esinencu
· img. Ivan Pozdneacov · muz. Vlad Druc · cu Veronica Grigoraș (Maria) și Vasile Tăbîrță (moș David)
· 73 min · Moldova-Film, 1986 (premiera 1987)
· [IMDb tt2144818](https://www.imdb.com/title/tt2144818/) · [Wikipedia RO](https://ro.wikipedia.org/wiki/Tunul_de_lemn) · [Wikidata Q7853393](https://www.wikidata.org/wiki/Q7853393)

---

## 1. Bottom line (verificat 25 iulie 2026)

**Versiunea digitalizată NU este publicată legal online, nicăieri.** Nu apare pe niciun
serviciu de streaming, nici gratuit, nici cu plată. Tot ce circulă pe YouTube / OK.ru /
my.mail.ru sunt rip-uri VHS/TV vechi, de calitate slabă — nu copia restaurată.

**Dar copia restaurată există.** A fost făcută cu ajutorul unor parteneri din București și
a fost prezentată public în toamna anului 2016, la 30 de ani de la premieră, cu Veronica
Grigoraș prezentă la Chișinău. Studioul a mai proiectat-o pe ecran mare în august 2020
(deschiderea „Open-air cinema" la Muzeul Național de Istorie).

Deci calea realistă: **(a) prinde difuzarea TV, (b) cere copia direct de la deținători.**

---

## 2. TV — cea mai probabilă cale

Filmul a mai fost difuzat pe **Moldova 1** și **Moldova 2** (TRM). Din 2021, filmele
digitalizate de Moldova-Film sunt date în eter tocmai pe aceste două canale.

| Canal | Grila săptămânală | Live stream |
|---|---|---|
| Moldova 1 | https://trm.md/ro/moldova-1 | https://moldova1.md/live |
| Moldova 2 | https://trm.md/ro/moldova-2 | https://moldova1.md/moldova2 |

Grila e publicată pe zile (luni–duminică) chiar în pagina canalului.
Rubricile în care apare de obicei: **„F.A." / „Film artistic", „Moldova de patrimoniu",
„Tezaur", „Filmoteca"**.

> ✅ **Acest repo verifică automat**, la fiecare 30 de minute prin GitHub Actions, ambele
> grile TRM plus fluxurile de știri, și te anunță (Telegram / e-mail) dacă apare
> „Tunul de lemn" sau orice alt titlu din `data/watchlist.json`.

**Notă importantă despre preaviz.** TRM publică server-side **doar grila zilei curente** —
zilele următoare se încarcă prin JavaScript, dintr-un endpoint care refuză cererile
din afara paginii. Deci preavizul din grilă e de ore, nu de zile. De aceea contează la fel
de mult *anunțurile* (Moldova-Film, TRM, Diez, Moldpres), care apar cu zile înainte, și
de aceea recorder-ul poate porni singur — vezi `recorder/record.mjs`.

---

## 3. Cui să te adresezi pentru copia restaurată

### Studioul „Moldova-Film" — deținătorul drepturilor
- Web: https://moldovafilm.md · Filmografie: https://moldovafilm.md/filmografie/
- Adresă: șos. Hîncești 61, Chișinău
- Tel: **+373 22 285 480** / +373 22 286 480
- E-mail: **info@moldovafilm.md**, administrare@moldovafilm.md
- Program: L–V, 8:30–17:30
- Facebook: https://www.facebook.com/profile.php?id=61574369442446

Studioul are serviciu comercial de **„Digitalizare pelicule"**
(https://moldovafilm.md/service/digitalizare-pelicule/) și **listă de prețuri**
(https://moldovafilm.md/service/price-list/) — adică se poate cere oficial o copie
digitală contra cost, sau licență de proiecție. Are și sala „Odeon" de închiriat, dacă
vrei o proiecție publică.

### Agenția Națională a Arhivelor (ANA)
Păstrează fondul de filme sovietice și colaborează formal cu Moldova-Film pe digitalizare.
- Web: https://arhiva.gov.md
- Pagina colaborării: https://arhiva.gov.md/colaborare-agentia-nationala-a-arhivelor-ana-studioul-moldova-film-smf/
- **YouTube — „Filme artistice din colecțiile ANA"** (27 filme digitalizate, oficial):
  https://www.youtube.com/playlist?list=PLFWbc2TxIiKHO2sc2RLvrtoNW10wJvfjC
  → *Tunul de lemn nu e (încă) în playlist. Merită urmărit — aici ar apărea primul.*
- Facebook: https://www.facebook.com/Agentia.Arhivelor/

### CINEMARON — platforma digitală națională
https://cinemaron.md · secțiunea On-line: https://cinemaron.md/online
Momentan doar 2 filme online (Turcoaica, Plaha) și 67 în bază. Filmul nu are încă fișă.
Contact: ceo@bizsamurai.me — merită cerut să adauge fișa filmului.

### Centrul Național al Cinematografiei
https://cnc.md/filme/ — instituția care finanțează digitalizarea.

---

## 4. Context: proiectul de digitalizare

Peste **1.600 de filme** din arhiva Moldova-Film sunt în proces de digitalizare, cu
sprijinul **UE** și al **Guvernului SUA**:
- 2021 — Ambasada SUA la Chișinău echipează laboratorul de digitalizare
- UE finanțează o mașină de spălare cu ultrasunete pentru pelicule
- Primul val: 10 filme artistice + 20 documentare, difuzate pe Moldova 1 și Moldova 2
- PNUD Moldova coordonează: https://www.undp.org/moldova/press-releases/more-1600-films-moldova-film-archive-will-be-digitized-support-european-union-and-us-government

Peliculele sunt pe 35 mm și se degradează — de aici urgența.

---

## 5. Ce poți face concret, în ordinea efortului

1. **Lasă radarul să ruleze** — Actions verifică la fiecare 30 min și te anunță când apare
   în grilă; cu `node recorder/record.mjs --watch --maybes` înregistrează și singur.
2. **Scrie la info@moldovafilm.md** — întreabă direct dacă versiunea restaurată se poate
   obține (copie digitală contra cost / licență / link de vizionare) și când e programată
   următoarea difuzare TV.
3. **Sună la +373 22 285 480** — răspund mai repede decât pe e-mail.
4. **Cere ANA** să adauge filmul în playlistul public de pe YouTube — e fond de arhivă,
   au deja 27 de titluri acolo.
5. **Cerere de informații de interes public** — dacă nu răspund. Moldova-Film e
   întreprindere de stat, are obligație de transparență
   (https://moldovafilm.md/actualitatea-econ-financiara/).

---

## 6. Copii existente online (referință — toate de calitate slabă)

Rip-uri vechi, listate doar ca punct de comparație, nu ca înlocuitor al versiunii restaurate:
YouTube (mai multe încărcări), OK.ru, my.mail.ru, moldova-film.clan.su, ortodox.md.

---

*Actualizat: 26 iulie 2026*

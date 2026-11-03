# Workout Flow

Timer per allenamenti dentro Obsidian.

- Fasi **a tempo**: lavoro → riposo → lavoro… in automatico, con beep (conto alla rovescia negli ultimi secondi, segnale diverso per lavoro, riposo e fine).
- Esercizi **a ripetizioni**: il timer si ferma e mostra il pulsante **Fatto**; quando lo premi parte il riposo e poi si prosegue.
- **Elenco completo** sotto il timer: tutti gli esercizi e i riposi in sequenza, divisi per giro, ognuno con il proprio tempo. La riga attiva è evidenziata e fa il conto alla rovescia; quelle già fatte sono spuntate.
- Pulsanti: Inizia / Pausa / Riprendi, Salta, Reset. Il nome dell'esercizio è un link alla sua nota.

## Installazione

1. Copia la cartella `workout-flow` (con `main.js`, `manifest.json`, `styles.css`) in `<tuo-vault>/.obsidian/plugins/`, sovrascrivendo i file della versione precedente.
2. In Obsidian: Impostazioni → Plugin della community → attiva **Workout Flow** (se era già attivo, disattivalo e riattivalo per ricaricarlo).

## Sintassi

Un blocco di codice `workout-flow`:

````
```workout-flow
titolo: HIIT
giri: 3
prep: 5s
riposo: 15s
riposo giri: 45s

- [[Squat]]: 12 rip
- [[Mountain Climber]]: 30s
- [[Wall Sit]]: 40s
- [[Ponte glutei]]: 15 rip, riposo 30s
- [[Flessioni]]: 10 rip
```
````

| Riga | Significato |
|---|---|
| `giri: N` | quante volte ripetere tutta la lista (default 1) |
| `prep: 5s` | conto alla rovescia iniziale (default 5s, `0s` per toglierlo) |
| `riposo: 15s` | riposo tra un esercizio e l'altro (default 15s) |
| `riposo giri: 45s` | riposo tra la fine di un giro e l'inizio del successivo (default 30s) |
| `- esercizio: 30s` | esercizio a tempo (`30s`, `1m`, `1m30s`) |
| `- esercizio: 12 rip` | esercizio a ripetizioni: aspetta "Fatto" |
| `..., riposo 30s` | riposo personalizzato **dopo** quell'esercizio |
| `- esercizio: 10 rip per lato` | l'esercizio diventa due passaggi di fila, "(sinistra)" e "(destra)", senza riposo in mezzo; funziona anche a tempo (`30s per lato`) e con "per gamba" / "per braccio" |

## Avvisi

Brevi promemoria mostrati nel timer come etichette.

- **Generali** (per tutti gli esercizi): una riga `avviso:` per ciascuno, nel blocco, prima dell'elenco (oppure più avvisi su una riga separati da `;`).
- **Solo per alcuni esercizi**: aggiungi `avviso ...` sulla riga dell'esercizio. Se il testo contiene virgole, mettilo tra virgolette: `avviso "Glutei contratti, bacino neutro"`.

Per dare un titolo al gruppo di avvisi (mostrato sopra le etichette) aggiungi `titolo avvisi: Postura`.

Gli avvisi specifici sono evidenziati. Durante la preparazione e il riposo compaiono quelli del prossimo esercizio, così li leggi prima di partire.

````
```workout-flow
titolo avvisi: Postura
avviso: Busto in tensione
avviso: Spalle aperte
avviso: Addome contratto
avviso: Schiena dritta

- [[Squat]]: 12 rip
- [[Ponte glutei]]: 15 rip, avviso Glutei contratti
- [[Wall Sit]]: 40s, avviso Glutei contratti
```
````

Con `per lato`, un eventuale `riposo` indicato sulla riga vale **dopo** il lato destro. Esempio:

````
- [[Affondi]]: 10 rip per lato, riposo 20s
````

Le righe che iniziano con `#` o `//` sono commenti. Tutto il resto è opzionale tranne l'elenco degli esercizi.

Puoi mettere più blocchi `workout-flow` nella stessa nota: ognuno ha il suo timer.

## Impostazioni

- **Volume** e **tipo di suono** (squillante / morbido / dolce), con pulsante per provarlo.
- Secondi di conto alla rovescia, vibrazione.

## Note

- Su telefono il suono parte dopo il primo tocco su **Inizia** (limite del browser): è normale.
- Se Obsidian va in background o lo schermo si spegne, il sistema può sospendere il timer. Il plugin chiede di tenere lo schermo acceso, dove supportato.

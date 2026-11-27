# Museo delle Cose Perdute

## 1. Presentazione del progetto

Il Museo delle Cose Perdute è un'applicazione web progettata per facilitare la ricerca, l'identificazione e la restituzione di oggetti smarriti e ritrovati.

La piattaforma permette agli utenti di pubblicare segnalazioni, consultare un archivio pubblico e individuare possibili corrispondenze tra oggetti smarriti e ritrovati.

Il progetto integra un sistema di moderazione delle segnalazioni e un meccanismo di verifica tra gli utenti coinvolti, finalizzato alla corretta identificazione del proprietario dell'oggetto.

## 2. Funzionalità principali

- Registrazione e autenticazione degli utenti.
- Inserimento di segnalazioni di smarrimento e ritrovamento.
- Moderazione delle segnalazioni prima della pubblicazione.
- Consultazione dell'archivio pubblico anche senza autenticazione.
- Suggerimento automatico di possibili corrispondenze (matching).
- Proposta di corrispondenza tra segnalazioni.
- Verifica mediante domanda e risposta privata.
- Conferma della corrispondenza.
- Aggiornamento dello stato delle segnalazioni.
- Sistema di notifiche.
- Conservazione persistente dei dati.
- Condivisione dei dati tra browser differenti collegati allo stesso server.

## 3. Tecnologie utilizzate

### Frontend

- HTML
- CSS
- JavaScript

### Backend

- Node.js

### Database

- SQLite, attraverso il modulo integrato node:sqlite di Node.js.

L'applicazione utilizza un'architettura client-server.

I dati principali non dipendono esclusivamente dal localStorage del browser, ma vengono gestiti attraverso il server e il database SQLite.

## 4. Struttura del progetto

    museo-delle-cose-perdute/
    |
    |-- public/
    |   |-- index.html
    |   |-- style.css
    |   |-- script.js
    |   |-- images
    |
    |-- server.js
    |-- promuovi-moderatore.js
    |-- package.json
    |-- .gitignore
    |-- README.md

Il file museo.sqlite viene generato automaticamente dal server.

Il database locale e i relativi file temporanei sono esclusi dal repository mediante il file .gitignore.

## 5. Requisiti per l'esecuzione

Per utilizzare l'applicazione è necessario disporre di:

- Node.js versione 22.13.0 o successiva.
- Un browser web, ad esempio Safari, Google Chrome o Firefox.
- Un terminale per l'avvio del server.

È consigliato l'utilizzo di Visual Studio Code per la consultazione e la revisione del codice sorgente.

## 6. Installazione e avvio

1. Scaricare o clonare il repository GitHub.
2. Aprire la cartella del progetto.
3. Aprire un terminale nella cartella principale.
4. Verificare la versione di Node.js:

   node --version

5. Avviare il server:

   npm start

6. Aprire il browser e inserire il seguente indirizzo:

   http://127.0.0.1:3000

Il database SQLite viene inizializzato automaticamente all'avvio, se non è già presente.

Per arrestare il server, premere Control + C nel terminale.

## 7. Ruoli degli utenti

### Visitatore

Può consultare l'archivio pubblico senza effettuare la registrazione o l'accesso.

### Utente registrato

Può inserire segnalazioni, gestire le proprie attività, proporre corrispondenze e partecipare al processo di verifica.

### Moderatore

Può esaminare le segnalazioni sottoposte a moderazione e approvarne la pubblicazione.

## 8. Creazione di un account moderatore

Per effettuare test sulle funzionalità di moderazione:

1. Avviare l'applicazione.
2. Registrare normalmente un nuovo account.
3. Aprire un secondo terminale nella cartella principale del progetto.
4. Eseguire il seguente comando:

   node promuovi-moderatore.js email@esempio.it

Sostituire email@esempio.it con l'indirizzo utilizzato durante la registrazione.

5. Effettuare il logout dall'account, se necessario.
6. Accedere nuovamente con le stesse credenziali.

L'account disporrà delle funzionalità previste per il ruolo di moderatore.

L'assegnazione di questo ruolo richiede l'accesso al terminale e al database locale.

## 9. Processo di identificazione e restituzione

Il funzionamento dell'applicazione prevede le seguenti fasi:

1. Inserimento di una segnalazione di smarrimento.
2. Inserimento di una segnalazione di ritrovamento.
3. Approvazione delle segnalazioni da parte del moderatore.
4. Individuazione di una possibile corrispondenza.
5. Proposta di matching.
6. Invio di una domanda privata da parte dell'utente che ha ritrovato l'oggetto.
7. Risposta da parte dell'utente che ha smarrito l'oggetto.
8. Valutazione della risposta.
9. Eventuale conferma della corrispondenza.
10. Aggiornamento delle segnalazioni allo stato "Risolta".

La domanda di verifica dovrebbe riguardare un dettaglio dell'oggetto non presente nelle informazioni pubbliche.

## 10. Test funzionali effettuati

Durante lo sviluppo sono stati eseguiti tre test funzionali manuali.

### Test 1 - Inserimento, moderazione e pubblicazione

Obiettivo: verificare il corretto funzionamento del sistema di gestione delle segnalazioni.

Sono state create due segnalazioni:

- Mario: smarrimento di un portachiavi.
- Lucia: ritrovamento di un portachiavi.

Entrambe le segnalazioni sono state approvate dal moderatore e visualizzate correttamente nell'archivio pubblico.

Esito: SUPERATO.

### Test 2 - Matching, verifica privata e risoluzione

Obiettivo: verificare il processo di identificazione dell'oggetto e di conferma della corrispondenza.

Sono state verificate le seguenti operazioni:

- Suggerimento automatico della corrispondenza.
- Proposta di matching da parte di Mario.
- Ricezione della proposta da parte di Lucia.
- Invio della domanda privata da parte di Lucia.
- Ricezione e risposta da parte di Mario.
- Visualizzazione della risposta da parte di Lucia.
- Conferma della corrispondenza.
- Aggiornamento di entrambe le segnalazioni allo stato "Risolta".

Dopo il logout, entrambe le segnalazioni sono risultate ancora visibili nell'archivio pubblico con lo stato "Risolta".

Esito: SUPERATO.

### Test 3 - Condivisione e persistenza dei dati

Obiettivo: verificare che il funzionamento dell'applicazione non dipenda esclusivamente dalla memoria locale di un singolo browser.

Il sito è stato utilizzato attraverso Safari e Google Chrome sullo stesso computer.

Sono stati verificati:

- Visualizzazione delle medesime segnalazioni nei due browser.
- Accesso agli account esistenti da entrambi i browser.
- Conservazione dello stato delle segnalazioni.
- Conservazione delle corrispondenze confermate.
- Persistenza dei dati dopo l'arresto e il riavvio del server Node.js.

Esito: SUPERATO.

### Riepilogo dei risultati

| Test   | Funzionalità                             | Esito    |
| ------ | ---------------------------------------- | -------- |
| Test 1 | Inserimento, moderazione e pubblicazione | Superato |
| Test 2 | Matching, verifica e risoluzione         | Superato |
| Test 3 | Condivisione e persistenza dei dati      | Superato |

Risultato complessivo: 3 test su 3 superati.

I test sono stati completati senza necessità di modificare il codice sorgente durante la sessione di verifica.

Ambiente di test: macOS, Visual Studio Code, Node.js, Safari e Google Chrome.

## 11. Indicazioni per i revisori

Il repository è destinato alla consultazione del codice sorgente, alla revisione tecnica e all'esecuzione di ulteriori test funzionali.

Il database utilizzato durante lo sviluppo non è incluso nel repository.

Ogni revisore può quindi:

- Avviare una propria istanza locale dell'applicazione.
- Registrare nuovi account di prova.
- Creare un account moderatore.
- Inserire nuove segnalazioni.
- Riprodurre i test descritti.
- Individuare eventuali anomalie.
- Proporre miglioramenti.

Si consiglia di utilizzare dati fittizi durante le attività di test.

## 12. Limiti delle verifiche effettuate

I test eseguiti hanno verificato il corretto funzionamento degli scenari funzionali descritti.

Non costituiscono una certificazione completa della sicurezza dell'applicazione.

L'accessibilità da dispositivi differenti, la resistenza agli accessi non autorizzati, la riservatezza dei dati privati e il comportamento sotto carico richiedono ulteriori verifiche.

L'applicazione viene attualmente eseguita in ambiente locale.

La pubblicazione del codice su GitHub non equivale alla pubblicazione online di un'istanza funzionante del sito.

## 13. Finalità del progetto

Il Museo delle Cose Perdute nasce come progetto didattico finalizzato alla realizzazione di un'applicazione web interattiva, dotata di gestione degli utenti, moderazione dei contenuti, matching e persistenza dei dati.

Il repository rappresenta la base per la revisione tecnica, la sperimentazione e gli eventuali sviluppi futuri.

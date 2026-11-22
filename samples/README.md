# Config di esempio sintetiche

Questa cartella contiene **solo dati inventati**. Servono per i test automatici, come esempi da trascinare nell'app e per generare gli screenshot della documentazione.

Non ci sono e non devono mai esserci configurazioni reali di clienti: la repo è pubblica.

## Cosa c'è

Le config descrivono una rete immaginaria: una sede, tre filiali, un campus e un datacenter, collegati da un overlay ADVPN con BGP e da un tunnel statico tra sede e datacenter. Sono una rete sola: l'app li mette insieme nella mappa dell'infrastruttura (#15). Hanno anche un problema voluto per ogni controllo di coerenza, descritti [più sotto](#problemi-voluti).

| Cartella | File | Apparato | Sistema |
|---|---|---|---|
| `fortigate/` | `fgt-br1-60f-fortios-7.0.conf` | FortiGate 60F, filiale 1 | FortiOS 7.0 |
| | `fgt-hq-100f-fortios-7.2-vdom.conf` | FortiGate 100F, sede, hub ADVPN, **VDOM multiple**, HA, OSPF verso il centro stella, policy route, servizi personalizzati, policy da controllare (disattivata, senza log, gestione aperta a tutti), tunnel statico VPN-DC verso il datacenter | FortiOS 7.2 |
| | `fgt-br2-60f-fortios-7.4.conf` | FortiGate 60F, filiale 2, con la porta dmz ancora all'indirizzo di fabbrica e il tunnel WAN2 senza proposte in comune con l'hub | FortiOS 7.4 |
| | `fgt-campus-200f-fortios-7.6.conf` | FortiGate 200F con **due FortiSwitch 248E-POE gestiti in coppia MCLAG** (ICL sulle porte 47 e 48, FortiLink sulla 49, trunk MCLAG verso gli switch delle aule sulla 45, porte 50–52 di riserva spente) e **quattro FortiAP 231F** con due SSID (aziendale con RADIUS e ospiti), certificato e messaggio su più righe, VPN verso la sede con la versione IKE di default e BGP sull'overlay | FortiOS 7.6 |
| | `fgt-dc-120g-fortios-8.0-vdom.conf` | FortiGate 120G, datacenter, **VDOM multiple**, eBGP verso due provider, tunnel statico VPN-HQ verso la sede | FortiOS 8.0 |
| `cisco-ios/` | `sw-br1-acc-c2960x-ios-15.2-stack.txt` | Catalyst 2960-X, **stack di 2**, fine riga Windows (CRLF), **VTP server**: le VLAN non sono nella config ma solo nello show | IOS 15.2 |
| | `sw-hq-acc1-c3850-iosxe-16.12-stack.txt` | Catalyst 3850, **stack di 2**, port security con MAC sticky, PoE statico sugli AP | IOS-XE 16.12 |
| | `sw-hq-acc2-c9200-iosxe-17.9.txt` | Catalyst 9200, singolo, **802.1X e MAB** | IOS-XE 17.9 |
| | `sw-hq-core-c9300-iosxe-17.12-stack.txt` | Catalyst 9300, **stack di 3**, centro stella: SVI, **OSPF**, **policy route**, rotte statiche, ACL su interfacce, VTY e SNMP, object-group, port-channel verso il FortiGate e i tre switch di accesso | IOS-XE 17.12 |
| `cisco-sb/` | `sw-br2-acc-sg350-28p-2.5.txt` | Cisco SG350-28P, singolo, porte AP in **modalità `general`**, LLDP e CDP spenti | Small Business 2.5 |
| | `sw-br3-acc-cbs350-48p-3.4-stack.txt` | Cisco CBS350-48P, **stack di 2** | Small Business 3.4 |
| | `sw-hq-acc3-c1300-48p-4.1-stack.txt` | Cisco Catalyst 1300-48P, **stack di 2**, uplink in port-channel statico verso SW-HQ-CORE scritto solo nelle descrizioni | Small Business 4.1 |
| `show/` | `sw-hq-core_show-version.txt` | `show version` del 9300, con prompt | IOS-XE |
| | `sw-hq-core_show-cdp-lldp-neighbors.txt` | due comandi nello stesso file | IOS-XE |
| | `fgt-hq_get-system-status.txt` | `get system status` del FortiGate di sede | FortiOS |
| | `sw-br1-acc_show-vlan-brief-senza-prompt.txt` | `show vlan brief` senza prompt: dà i nomi delle VLAN tenute dal VTP | IOS |
| | `sw-hq-core_sessione.txt` | log di sessione del 9300: inventario, stato delle porte, port-channel, tabella MAC (con porte configurate senza MAC), ARP, PoE e vicini LLDP | IOS-XE 17.12 |
| | `sw-br1-acc_sessione.txt` | log di sessione del 2960-X con fine riga Windows (CRLF): `show version` con lo stack, stato delle porte, tabella MAC, PoE e il vicino LLDP sull'uplink verso FGT-BR1 | IOS 15.2 |
| | `sw-br3-acc_sessione.txt` | log di sessione del CBS350 con i formati Small Business: versione, inventario, porte, VLAN, vicini LLDP, tabella MAC e PoE | Small Business 3.4 |
| | `fgt-hq_sessione.txt` | log di sessione del FortiGate di sede, con i prompt delle VDOM (`config vdom`, `edit OFFICE`): interfacce, tunnel con i peer dial-up e il tunnel verso il datacenter, gateway IKE, routing e BGP | FortiOS 7.2 |
| | `fgt-br1_sessione.txt` | log di sessione della filiale 1: stato, health check e regole SD-WAN, tunnel con la scorciatoia ADVPN aperta verso la filiale 2, routing e BGP | FortiOS 7.0 |
| | `fgt-campus_sessione.txt` | log di sessione del FortiGate del campus: stato, stato dei due FortiSwitch gestiti e MAC sulle loro porte, con porte configurate senza MAC | FortiOS 7.6 |
| `versioni/` | `sw-hq-core-c9300-iosxe-17.12-stack_2025-06-30.txt` | versione precedente del 9300 di sede: data dell'ultima modifica scritta nella config, porte di riserva, altro rack | IOS-XE 17.12 |
| | `fgt-br1-60f-fortios-7.0_2025-05-12.conf` | versione precedente del FortiGate della filiale 1, senza i profili di sicurezza sulla policy verso Internet: la data è nel nome del file, perché FortiOS non la scrive nella config | FortiOS 7.0 |

[`mappa-esempio.json`](mappa-esempio.json) è la mappa del cliente di esempio modificata a mano (#15, parte 3), come l'app la salva in `map.json`: lo switch del datacenter e i server della DMZ aggiunti come nodi, con i loro cavi; un cavo verso lo switch del vecchio magazzino, che non è più tra gli apparati, ed è segnalato; il LAG di SW-HQ-ACC3, dedotto dalle descrizioni, confermato a mano. I test del core e del server la leggono entrambi.

[`cliente-esempio.zip`](cliente-esempio.zip) è un cliente esportato dall'app, "Esempio Rete Srl", con tutti questi file e la sua mappa: si importa dal menu dei clienti (*Importa da un file zip*) per provare l'app con un cliente completo, ed è anche la base degli screenshot della documentazione. Dopo una modifica agli esempi o a `mappa-esempio.json` si rifà con `node scripts/example-client.mjs`, che tiene nomi, date e correzioni, aggiunge in coda gli esempi nuovi e aggiorna i file, la mappa, le dimensioni e gli sha256; un test controlla che lo zip resti uguale agli esempi.

Il riconoscimento atteso per ogni file è in [`expected.json`](expected.json); il riassunto atteso del modello di ogni config (porte, VLAN, ACL, routing, copertura) è in [`expected-models.json`](expected-models.json). Entrambi vengono verificati dai test.

I collegamenti attesi tra gli apparati, con i siti, i nodi fuori dal cliente, i problemi trovati dai controlli di coerenza e le coppie di filiali ADVPN, sono in [`expected-links.json`](expected-links.json), verificato dai test della correlazione (#15).

## Problemi voluti

Per ogni controllo di coerenza (#15, parte 2) gli esempi hanno almeno un problema, con la causa nella config:

| Controllo | Dove | Causa |
|---|---|---|
| Tunnel IPsec | FGT-BR2 HUB-WAN2 ↔ FGT-HQ ADVPN-WAN2 | la filiale propone solo `aes128-sha1` con il gruppo DH 21, che l'hub non ha (sull'hub i gruppi DH sono il default di FortiOS, quindi l'avviso è "da verificare") |
| Sessione BGP | FGT-BR2 ↔ FGT-HQ su WAN2 | giù negli show della sede: il tunnel che la porta non si negozia |
| Trunk | SW-HQ-ACC2 Po1 ↔ SW-HQ-CORE Po11 | VLAN nativa 999 sullo switch di accesso, 1 sul centro stella |
| LAG | SW-HQ-ACC3 Po1 ↔ SW-HQ-CORE Po12 | statico (`channel-group 1 mode on`) da un lato, LACP active dall'altro: negli show il Po12 è giù e le porte sono sospese |
| MTU | FGT-HQ LAG-CORE ↔ SW-HQ-CORE Po1 | 9000 sul FortiGate, il default di 1500 sullo switch |
| OSPF | FGT-HQ VL99-MGMT ↔ SW-HQ-CORE Vlan99 | il FortiGate fa OSPF anche sulla rete di gestione, che sul centro stella è passiva (`passive-interface default`) |
| Indirizzi | FGT-BR2 dmz e FGT-HQ VL10-DATA | la porta dmz della filiale 2 ha ancora l'indirizzo di fabbrica 10.10.10.1/24, lo stesso del gateway della VLAN dati della sede |
| Rotte attese | FGT-BR1 | negli show manca 10.30.0.0/16, che il campus annuncia in BGP |
| Descrizioni | SW-HQ-CORE Gi3/0/48 | la descrizione nomina SW-HQ-ACC1, CDP vede SW-HQ-ACC2 |
| LLDP e CDP | SW-BR2-ACC Gi1/0/28 | LLDP e CDP spenti (`no lldp run`, `no cdp run`): il cavo verso FGT-BR2 resta dedotto dalla descrizione |
| ADVPN | FGT-CAMPUS | la policy verso l'overlay permette solo le reti della sede e del datacenter: le scorciatoie verso le filiali non possono partire |

Dopo una modifica voluta a un driver, alla correlazione o a un esempio, i risultati attesi si rigenerano con `NCV_UPDATE_EXPECTED=1 npx vitest run packages/core/test/samples-model.test.ts packages/core/test/correlate.test.ts` e le differenze si controllano a mano prima del commit.

## Come sono fatti i dati

- **Indirizzi IP pubblici** solo dai blocchi riservati alla documentazione (RFC 5737): `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`.
- **Indirizzi IP privati** inventati (`10.x`, `172.16.x`), **dominio** `esempio.example` (riservato, RFC 2606), **indirizzi MAC** dal blocco di documentazione `00:00:5e:00:53:xx` (RFC 7042).
- **Output dei comandi show** coerenti con le config: stessi hostname, numeri di serie, porte, VLAN, port-channel, tunnel e regole SD-WAN, così l'app li abbina al loro apparato.
- **Password, chiavi, PSK, certificati e numeri di serie** sono finti. Se si decodificano, i valori cifrati, le chiavi e i certificati contengono il testo "ESEMPIO SINTETICO - NON REALE". Non sono validi e non funzionano su nessun apparato.

## Quanto sono fedeli

La sintassi segue quella reale, ma non tutto è verificato su un apparato vero:

- le config **FortiOS 8.0** seguono la sintassi della 7.6 con l'intestazione della 8.0, perché i riferimenti pubblici sulla 8.0 sono pochi;
- le config **Cisco Small Business** riprendono la struttura delle versioni 2.x–4.x, ma alcuni comandi possono differire tra modelli e firmware;
- gli output dei comandi per i **FortiSwitch gestiti** (`execute switch-controller get-conn-status` e `diagnose switch-controller switch-info mac-table`) sono scritti senza un output reale di riferimento: i loro formati sono da verificare;
- le config sono più corte di quelle reali: mancano molte sezioni con i valori di default.

Quando un parser sbaglia su una config reale, le righe che danno problemi (con i valori sensibili cambiati a mano) servono a correggere sia il parser sia questi esempi.

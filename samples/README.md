# Config di esempio sintetiche

Questa cartella contiene **solo dati inventati**. Servono per i test automatici, come esempi da trascinare nell'app e per generare gli screenshot della documentazione.

Non ci sono e non devono mai esserci configurazioni reali di clienti: la repo è pubblica.

## Cosa c'è

Le config descrivono una rete immaginaria: una sede, tre filiali, un campus e un datacenter, collegati da un overlay ADVPN con BGP.

| Cartella | File | Apparato | Sistema |
|---|---|---|---|
| `fortigate/` | `fgt-br1-60f-fortios-7.0.conf` | FortiGate 60F, filiale 1 | FortiOS 7.0 |
| | `fgt-hq-100f-fortios-7.2-vdom.conf` | FortiGate 100F, sede, hub ADVPN, **VDOM multiple**, HA, OSPF verso il centro stella, policy route, servizi personalizzati, policy da controllare (disattivata, senza log, gestione aperta a tutti) | FortiOS 7.2 |
| | `fgt-br2-60f-fortios-7.4.conf` | FortiGate 60F, filiale 2 | FortiOS 7.4 |
| | `fgt-campus-200f-fortios-7.6.conf` | FortiGate 200F con FortiSwitch e FortiAP gestiti, certificato e messaggio su più righe, VPN verso la sede con la versione IKE di default | FortiOS 7.6 |
| | `fgt-dc-120g-fortios-8.0-vdom.conf` | FortiGate 120G, datacenter, **VDOM multiple** | FortiOS 8.0 |
| `cisco-ios/` | `sw-br1-acc-c2960x-ios-15.2-stack.txt` | Catalyst 2960-X, **stack di 2**, fine riga Windows (CRLF), **VTP server**: le VLAN non sono nella config ma solo nello show | IOS 15.2 |
| | `sw-hq-acc1-c3850-iosxe-16.12-stack.txt` | Catalyst 3850, **stack di 2**, port security con MAC sticky, PoE statico sugli AP | IOS-XE 16.12 |
| | `sw-hq-acc2-c9200-iosxe-17.9.txt` | Catalyst 9200, singolo, **802.1X e MAB** | IOS-XE 17.9 |
| | `sw-hq-core-c9300-iosxe-17.12-stack.txt` | Catalyst 9300, **stack di 3**, centro stella: SVI, **OSPF**, **policy route**, rotte statiche, ACL su interfacce, VTY e SNMP, object-group | IOS-XE 17.12 |
| `cisco-sb/` | `sw-br2-acc-sg350-28p-2.5.txt` | Cisco SG350-28P, singolo, porte AP in **modalità `general`** | Small Business 2.5 |
| | `sw-br3-acc-cbs350-48p-3.4-stack.txt` | Cisco CBS350-48P, **stack di 2** | Small Business 3.4 |
| | `sw-hq-acc3-c1300-48p-4.1-stack.txt` | Cisco Catalyst 1300-48P, **stack di 2** | Small Business 4.1 |
| `show/` | `sw-hq-core_show-version.txt` | `show version` del 9300, con prompt | IOS-XE |
| | `sw-hq-core_show-cdp-lldp-neighbors.txt` | due comandi nello stesso file | IOS-XE |
| | `fgt-hq_get-system-status.txt` | `get system status` del FortiGate di sede | FortiOS |
| | `sw-br1-acc_show-vlan-brief-senza-prompt.txt` | `show vlan brief` senza prompt: dà i nomi delle VLAN tenute dal VTP | IOS |
| | `sw-hq-core_sessione.txt` | log di sessione del 9300: inventario, stato delle porte, port-channel, tabella MAC (con porte configurate senza MAC), ARP, PoE e vicini LLDP | IOS-XE 17.12 |
| | `sw-br1-acc_sessione.txt` | log di sessione del 2960-X con fine riga Windows (CRLF): `show version` con lo stack, stato delle porte, tabella MAC e PoE | IOS 15.2 |
| | `sw-br3-acc_sessione.txt` | log di sessione del CBS350 con i formati Small Business: versione, inventario, porte, VLAN, vicini LLDP, tabella MAC e PoE | Small Business 3.4 |
| | `fgt-hq_sessione.txt` | log di sessione del FortiGate di sede, con i prompt delle VDOM (`config vdom`, `edit OFFICE`): interfacce, tunnel con i peer dial-up, gateway IKE, routing e BGP | FortiOS 7.2 |
| | `fgt-br1_sessione.txt` | log di sessione della filiale 1: stato, health check e regole SD-WAN, tunnel, routing e BGP | FortiOS 7.0 |
| `versioni/` | `sw-hq-core-c9300-iosxe-17.12-stack_2025-06-30.txt` | versione precedente del 9300 di sede: data dell'ultima modifica scritta nella config, porte di riserva, altro rack | IOS-XE 17.12 |
| | `fgt-br1-60f-fortios-7.0_2025-05-12.conf` | versione precedente del FortiGate della filiale 1, senza i profili di sicurezza sulla policy verso Internet: la data è nel nome del file, perché FortiOS non la scrive nella config | FortiOS 7.0 |

[`cliente-esempio.zip`](cliente-esempio.zip) è un cliente esportato dall'app, "Esempio Rete Srl", con tutti questi file: si importa dal menu dei clienti (*Importa da un file zip*) per provare l'app con un cliente completo, ed è anche la base degli screenshot della documentazione. Per rifarlo dopo una modifica agli esempi: crea un cliente nell'app, caricaci i file di questa cartella (le config, `versioni/` e `show/`), esportalo e mettilo qui con questo nome.

Il riconoscimento atteso per ogni file è in [`expected.json`](expected.json); il riassunto atteso del modello di ogni config (porte, VLAN, ACL, routing, copertura) è in [`expected-models.json`](expected-models.json). Entrambi vengono verificati dai test.

Dopo una modifica voluta a un driver o a un esempio, il riassunto si rigenera con `NCV_UPDATE_EXPECTED=1 npx vitest run packages/core/test/samples-model.test.ts` e le differenze si controllano a mano prima del commit.

## Come sono fatti i dati

- **Indirizzi IP pubblici** solo dai blocchi riservati alla documentazione (RFC 5737): `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`.
- **Indirizzi IP privati** inventati (`10.x`, `172.16.x`), **dominio** `esempio.example` (riservato, RFC 2606), **indirizzi MAC** dal blocco di documentazione `00:00:5e:00:53:xx` (RFC 7042).
- **Output dei comandi show** coerenti con le config: stessi hostname, numeri di serie, porte, VLAN, port-channel, tunnel e regole SD-WAN, così l'app li abbina al loro apparato.
- **Password, chiavi, PSK, certificati e numeri di serie** sono finti. Se si decodificano, i valori cifrati, le chiavi e i certificati contengono il testo "ESEMPIO SINTETICO - NON REALE". Non sono validi e non funzionano su nessun apparato.

## Quanto sono fedeli

La sintassi segue quella reale, ma non tutto è verificato su un apparato vero:

- le config **FortiOS 8.0** seguono la sintassi della 7.6 con l'intestazione della 8.0, perché i riferimenti pubblici sulla 8.0 sono pochi;
- le config **Cisco Small Business** riprendono la struttura delle versioni 2.x–4.x, ma alcuni comandi possono differire tra modelli e firmware;
- le config sono più corte di quelle reali: mancano molte sezioni con i valori di default.

Quando un parser sbaglia su una config reale, le righe che danno problemi (con i valori sensibili cambiati a mano) servono a correggere sia il parser sia questi esempi.

# Config di esempio sintetiche

Questa cartella contiene **solo dati inventati**. Servono per i test automatici, come esempi da trascinare nell'app e per generare gli screenshot della documentazione.

Non ci sono e non devono mai esserci configurazioni reali di clienti: la repo è pubblica.

## Cosa c'è

Le config descrivono una rete immaginaria: una sede, tre filiali, un campus e un datacenter, collegati da un overlay ADVPN con BGP.

| Cartella | File | Apparato | Sistema |
|---|---|---|---|
| `fortigate/` | `fgt-br1-60f-fortios-7.0.conf` | FortiGate 60F, filiale 1 | FortiOS 7.0 |
| | `fgt-hq-100f-fortios-7.2-vdom.conf` | FortiGate 100F, sede, hub ADVPN, **VDOM multiple** | FortiOS 7.2 |
| | `fgt-br2-60f-fortios-7.4.conf` | FortiGate 60F, filiale 2 | FortiOS 7.4 |
| | `fgt-campus-200f-fortios-7.6.conf` | FortiGate 200F con FortiSwitch e FortiAP gestiti, certificato e messaggio su più righe | FortiOS 7.6 |
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
| | `sw-br1-acc_show-vlan-brief-senza-prompt.txt` | `show vlan brief` senza prompt | IOS |

Il riconoscimento atteso per ogni file è in [`expected.json`](expected.json); il riassunto atteso del modello di ogni config (porte, VLAN, ACL, routing, copertura) è in [`expected-models.json`](expected-models.json). Entrambi vengono verificati dai test.

Dopo una modifica voluta a un driver o a un esempio, il riassunto si rigenera con `NCV_UPDATE_EXPECTED=1 npx vitest run packages/core/test/samples-model.test.ts` e le differenze si controllano a mano prima del commit.

## Come sono fatti i dati

- **Indirizzi IP pubblici** solo dai blocchi riservati alla documentazione (RFC 5737): `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`.
- **Indirizzi IP privati** inventati (`10.x`, `172.16.x`), **dominio** `esempio.example` (riservato, RFC 2606), **indirizzi MAC** dal blocco di documentazione `00:00:5e:00:53:xx` (RFC 7042).
- **Password, chiavi, PSK, certificati e numeri di serie** sono finti. Se si decodificano, i valori cifrati, le chiavi e i certificati contengono il testo "ESEMPIO SINTETICO - NON REALE". Non sono validi e non funzionano su nessun apparato.

## Quanto sono fedeli

La sintassi segue quella reale, ma non tutto è verificato su un apparato vero:

- le config **FortiOS 8.0** seguono la sintassi della 7.6 con l'intestazione della 8.0, perché i riferimenti pubblici sulla 8.0 sono pochi;
- le config **Cisco Small Business** riprendono la struttura delle versioni 2.x–4.x, ma alcuni comandi possono differire tra modelli e firmware;
- le config sono più corte di quelle reali: mancano molte sezioni con i valori di default.

Quando un parser sbaglia su una config reale, le righe che danno problemi (con i valori sensibili cambiati a mano) servono a correggere sia il parser sia questi esempi.

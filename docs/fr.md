# IOmeter pour Gladys Assistant

Intégration non officielle, sans lien avec IOmeter GmbH. **Jamais testé avec un
vrai IOmeter** : construite d'après la bibliothèque cliente publiée par le
fabricant. Merci de signaler ce que vous voyez.

## Ce qu'elle fait

IOmeter est un lecteur posé sur l'interface optique d'un compteur intelligent
allemand (moderne Messeinrichtung ou passerelle de compteur), avec un pont
Wi-Fi sur votre réseau. Cette intégration lit **l'API locale du pont**, sans
cloud ni compte, et **en lecture seule** : elle n'écrit rien sur le pont ni sur
le compteur.

| Valeur                                                                                   | Dans Gladys                                     | Quand           |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------- |
| Puissance prélevée sur le réseau (W)                                                     | capteur d'énergie, puissance                    | toutes les 10 s |
| Puissance nette, négative en injection (W)                                               | capteur                                         | toutes les 10 s |
| Index de consommation 1.8.0 (kWh)                                                        | capteur d'énergie, index : le suivi énergétique | chaque minute   |
| Index des tarifs 1 et 2, index d'injection 2.8.0 (kWh)                                   | capteurs                                        | chaque minute   |
| Puissance de chaque phase (W)                                                            | capteurs                                        | toutes les 10 s |
| Pile du lecteur (%), signaux du pont et du lecteur (dBm), lecteur connecté et posé (1/0) | capteurs                                        | chaque minute   |

Seules les valeurs que votre compteur donne sont créées. Gladys calcule
lui-même la consommation et son coût à partir de l'index de consommation.
L'injection n'y entre pas : c'est un simple capteur. Ce n'est pas l'intégration
Discovergy (inexogy), qui lit le cloud de l'opérateur de comptage.

## Mise en place

1. Installez votre IOmeter avec son application, pour que le pont soit sur
   votre Wi-Fi.
2. Trouvez l'adresse IP du pont dans votre box ou dans l'application IOmeter.
   Vous pouvez aussi laisser l'adresse vide et ouvrir l'onglet **Découverte** :
   les ponts annoncés sur votre réseau sont listés dans l'état de
   l'intégration (rien n'est lu tant que vous n'avez pas saisi d'adresse).
3. Saisissez l'adresse dans la configuration de l'intégration et enregistrez.
   Cliquez sur **Tester la connexion** : elle lit une fois la puissance nette
   et l'index de consommation.
4. Dans l'onglet **Découverte**, créez l'appareil IOmeter.

Donnez au pont une adresse fixe dans votre box. Si elle change, saisissez la
nouvelle : l'appareil et son historique sont gardés.

## La garde de l'index de consommation

L'index de consommation est facturé par Gladys : un faux saut compterait des
kWh jamais consommés. L'intégration ne publie donc un nouvel index que s'il est
plausible après le précédent (pas plus bas, pas plus de 100 kW en moyenne
depuis). Un saut ou une baisse est **retenu** : la dernière valeur acceptée est
renvoyée, l'état de l'intégration dit ce qui est retenu, et cela reste retenu
après un redémarrage. Ni le temps ni la répétition ne le confirment.

Si la valeur est juste (nouveau compteur, remise à zéro, longue coupure),
cliquez deux fois sur **Accepter l'index retenu** dans la configuration : le
premier clic liste la valeur et n'accepte rien, le second, quelques secondes
plus tard et dans les 5 minutes, prend exactement cette valeur. Un saut est
alors compté d'un coup comme consommation ; une baisse ne facture rien et la
consommation repart de là. Enregistrer la configuration n'accepte rien.

Les index de tarif et d'injection ne sont jamais publiés plus bas qu'avant ni
à 0 ; accepter une baisse de l'index de consommation (nouveau compteur) les
laisse repartir des nouvelles valeurs. Un saut de l'un d'eux plus grand que ce
qu'un foyer peut consommer est retenu aussi (il ne devient jamais le nouveau
plancher) : il reprend dès que le compteur redonne une valeur plausible, ou
quand le compteur a donné la nouvelle valeur pendant une heure, chaque relevé
plausible après le précédent (ces index ne sont pas facturés). Sur un nouvel appareil, leur première
valeur est envoyée quand un second relevé la confirme.

## Ce que dit l'état

- **Connecté**, avec des notes : la page d'état qui ne répond pas (la lecture
  continue), aucun nouveau relevé du compteur depuis 5 minutes (la puissance
  n'est alors plus envoyée : lecteur décroché, pile vide ou hors de portée
  radio), un relevé vieux de plus de 2 heures, jugé sur l'horloge du pont
  quand il la donne (rien n'en est alors envoyé, les index non plus), pas de
  registre d'index, un compteur lu plus bas qu'avant, un index
  retenu.
- **N'a pas pu être lu** : pas de réponse, injoignable, erreur HTTP, réponse
  trop grande (plus de 64 Kio) ou qui n'est pas celle d'un IOmeter, aucun
  relevé pour l'instant. L'intégration réessaie après 10 s, puis attend deux
  fois plus à chaque fois, jusqu'à 5 minutes.
- Quand Gladys ne donne pas la configuration à une connexion, l'intégration
  réessaie de la même façon, sans fin.

Le bouton **Tester la connexion** et l'onglet **Découverte** lisent le pont
tout de suite, hors du rythme de 10 secondes et sans attendre un délai de
nouvel essai (une requête à la fois).

## Vie privée

Le numéro du compteur, l'identifiant d'installation et celui du pont sont
ignorés par l'intégration (jamais extraits des réponses) : ils n'atteignent ni
journal, ni état, ni fichier. /data ne garde que la référence de l'index de consommation et la
valeur retenue.

## Limites

- Jamais testé avec un vrai IOmeter : les pages, unités et codes OBIS sont
  ceux de la bibliothèque du fabricant (version 1.0.3).
- Le pont propose aussi un flux (Server-Sent Events) ; cette intégration
  l'interroge plutôt toutes les 10 secondes.
- Un pont par intégration.

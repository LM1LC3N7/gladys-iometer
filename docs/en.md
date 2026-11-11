# IOmeter for Gladys Assistant

Unofficial integration, not affiliated with IOmeter GmbH. **Never tested with a
real IOmeter**: built from the client library published by the maker. Please
report what you see.

## What it does

IOmeter is a reader clipped on the optical port of a German smart meter
(moderne Messeinrichtung or smart meter gateway), with a Wi-Fi bridge on your
network. This integration reads the **local API of the bridge**, without any
cloud nor account, and is **read only**: it never writes anything to the
bridge nor to the meter.

| Value                                                                                    | In Gladys                                   | When         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- | ------------ |
| Power taken from the grid (W)                                                            | energy sensor, power                        | every 10 s   |
| Net power, negative when injecting (W)                                                   | sensor                                      | every 10 s   |
| Consumption index 1.8.0 (kWh)                                                            | energy sensor, index: the energy monitoring | every minute |
| Tariff 1 and 2 indexes, injection index 2.8.0 (kWh)                                      | sensors                                     | every minute |
| Power of each phase (W)                                                                  | sensors                                     | every 10 s   |
| Reader battery (%), bridge and reader signals (dBm), reader connected and attached (1/0) | sensors                                     | every minute |

Only the values your meter gives are created. Gladys derives the consumption
and its cost from the consumption index by itself. The injection is never in
it: it is a plain sensor. This is not the Discovergy (inexogy) integration,
which reads the cloud of the metering operator.

## Setup

1. Set up your IOmeter with its app, so that the bridge is on your Wi-Fi.
2. Find the IP address of the bridge in your router or in the IOmeter app. You
   can also leave the address empty and open the **Discover** tab: the bridges
   announced on your network are listed in the status of the integration
   (nothing is read until you enter an address).
3. Enter the address in the configuration of the integration and save. Click
   **Test the connection**: it reads the net power and the consumption index
   once.
4. In the **Discover** tab, create the IOmeter device.

Give the bridge a fixed address in your router. If it changes, enter the new
one: the device and its history are kept.

## The consumption index guard

The consumption index is billed by Gladys: a wrong jump would count kWh that
were never used. So the integration publishes a new index only when it is
plausible after the last one (not lower, not more than 100 kW on average since
then). A jump or a drop is **held back**: the last accepted value is sent
again, the status of the integration says what is held, and it stays held
across restarts. Nothing confirms it by time nor by repetition.

If the value is right (a new meter, a reset, a long outage), click **Accept the
held index** twice in the configuration: the first click lists the value and
accepts nothing, the second one, a few seconds later and within 5 minutes,
takes exactly that value. A jump is then counted at once as consumption; a
drop bills nothing and the consumption goes on from there. Saving the
configuration accepts nothing.

The tariff and injection indexes are never published lower than before nor at
0; accepting a drop of the consumption index (a new meter) lets them start
again from the new values. A jump of one of them further than a home can use
is held too (it never becomes the new floor): it is taken back as soon as the
meter gives a plausible value again, or once the meter has kept giving the new
value, each reading plausible after the one before, for an hour (these
indexes are not billed).

## What the status says

- **Connected**, with notes: the status page not answering (the reading goes
  on), no new reading of the meter for 5 minutes (the power is then no longer
  sent: reader off the meter, battery empty or out of radio range), a reading
  more than 2 hours old, judged on the clock of the bridge when it gives one
  (then nothing of it is sent, the indexes neither), no index
  register, a counter read lower than before, an index held back.
- **Could not be read**: no answer, unreachable, HTTP error, an answer too
  large (over 64 KiB) or that is not an IOmeter one, no reading yet. The
  integration tries again after 10 s, then waits twice as long each time, up
  to 5 minutes.
- When Gladys does not give the configuration at a connection, the
  integration tries again the same way, without end.

The **Test the connection** button and the **Discover** tab read the bridge
at once, outside the 10-second rhythm and without waiting for a retry delay
(one request at a time).

## Privacy

The meter number, the installation id and the id of the bridge are ignored by
the integration (never taken out of the answers): they reach no log, status
nor file. /data holds only the
reference of the consumption index and the value held back.

## Limits

- Never tested with a real IOmeter: the pages, units and OBIS codes are those
  of the maker's library (version 1.0.3).
- The bridge also offers a stream (Server-Sent Events); this integration polls
  every 10 seconds instead.
- One bridge per integration.

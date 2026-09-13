# broadcast

A frame addressed to everyone on the wire at once, using the special MAC `ff:ff:ff:ff:ff:ff`. Every machine receives it and every machine has to look at it. ARP requests are broadcast because the sender does not yet know who to ask.

It is tempting to read the all-ones MAC as the MAC-world version of `0.0.0.0/0`, and the instinct is half right. Both mean "everything". But `0.0.0.0/0` is a pattern in a routing table that matches any destination, while `ff:ff:ff:ff:ff:ff` is a real address on a frame that tells the cable to deliver to all of them. IP has its own broadcast address for that job: `255.255.255.255`, or the last address in a subnet, like `10.0.1.255`.

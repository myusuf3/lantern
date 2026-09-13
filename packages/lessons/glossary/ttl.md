# TTL

Time to live. A counter in every IP packet that each router lowers by one. When it reaches zero the packet is thrown away and the sender is told. It is there so a packet caught in a loop dies instead of circling forever.

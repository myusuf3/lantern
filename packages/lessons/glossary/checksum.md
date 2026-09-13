# checksum

A number computed from a header and stored inside it. The receiver computes it again; if the two differ, something was corrupted on the way and the packet is dropped. IP checks its header this way, and ICMP checks its whole message.

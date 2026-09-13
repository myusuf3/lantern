# time exceeded

The ICMP message a router sends back to a packet's source when it lowers the TTL to zero and throws the packet away. It carries the first bytes of the dead packet so the sender can tell which one it was, and it comes from the router's own address, which is how traceroute learns the path.

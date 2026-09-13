# traceroute

A tool that maps the routers between you and a destination by sending probes with TTL 1, then 2, then 3, and noting which router sends back time exceeded for each. Each answer names one hop. The trace ends when the destination itself replies.

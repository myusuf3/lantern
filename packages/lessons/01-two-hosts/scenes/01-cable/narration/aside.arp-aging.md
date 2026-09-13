In this demo an ARP entry lasts forever. On a real machine it expires after a minute or so and gets re-learned, so ARP requests are happening on your network all the time, quietly.

That constant re-learning is also a weakness. Any machine on the wire can shout "I am the gateway, here is my MAC" and hosts will believe it. That is ARP cache poisoning, and it is how someone on the same coffee shop wifi ends up in the middle of your traffic.

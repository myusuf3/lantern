Every step you clicked through was a simulation. Here is the part that makes it more than a cartoon: it wrote packets.

Each scene produced a capture file, the same `.pcap` format that `tcpdump` writes and Wireshark reads. The bytes in them are the bytes you saw in the frame inspector, checksums and all. Nothing was drawn for the screen and then described in the file. The file came first; the screen was made from it.

You do not have to take that on faith. Download any capture below and open it in [[Wireshark]], or drop it into Wireview, which is Wireshark's own dissectors compiled to run in your browser. You will find the same frames, in the same order, with the MAC addresses changing at the router and the TTL dropping by one, exactly as the lesson said. Every capture on this site is also run through `tshark` in the test suite before it ships, so if a byte were wrong, the build would be red.

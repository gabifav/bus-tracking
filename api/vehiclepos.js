let map;
let busMarkers = {};

function startApp() {
  map = L.map("map").setView([-33.8848, 151.1571], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  document.getElementById("status").textContent = "Loading real 445 buses...";
  loadReal445Buses();

  setInterval(loadReal445Buses, 15000);
}

async function loadReal445Buses() {
  try {
    const response = await fetch("/api/vehiclepos");
    const data = await response.json();

    document.getElementById("status").textContent =
      `Real route 445 buses found: ${data.count}`;

    document.getElementById("nextBus").textContent =
      "Live data refreshes every 15 seconds";

    data.buses.forEach(bus => {
      const position = [bus.lat, bus.lng];

      if (busMarkers[bus.id]) {
        busMarkers[bus.id].setLatLng(position);
      } else {
        const busIcon = L.divIcon({
          html: "🚌",
          className: "bus-icon",
          iconSize: [30, 30]
        });

        busMarkers[bus.id] = L.marker(position, {
          icon: busIcon
        }).addTo(map);

        busMarkers[bus.id].bindPopup(`Route 445<br>Trip: ${bus.tripId}`);
      }
    });
  } catch (error) {
    document.getElementById("status").textContent =
      "Could not load real bus data";
    console.error(error);
  }
}

function showDirection(direction) {
  alert("Direction filtering can be added next.");
}

function findMe() {
  navigator.geolocation.getCurrentPosition(position => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    L.marker([lat, lng]).addTo(map).bindPopup("You are here");
    map.setView([lat, lng], 15);
  });
}

startApp();
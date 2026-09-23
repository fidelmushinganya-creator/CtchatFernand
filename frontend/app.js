// FernandAkasinga — logique frontend
// Chaque page ne fait que ce qui la concerne : on détecte les éléments
// présents dans le DOM pour savoir sur quelle page on se trouve.

(function () {
  "use strict";

  // ---------- Utilitaires ----------

  async function appelApi(url, options) {
    const reponse = await fetch(url, options);
    if (reponse.status === 401) {
      window.location.href = "/";
      throw new Error("non authentifié");
    }
    return reponse;
  }

  function formaterHeure(dateIso) {
    const d = new Date(dateIso + "Z");
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function formaterJour(dateIso) {
    const d = new Date(dateIso + "Z");
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  function formaterDuree(secondes) {
    if (!isFinite(secondes)) return "0:00";
    const m = Math.floor(secondes / 60);
    const s = Math.floor(secondes % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  // ---------- Page de connexion ----------

  const formulaireConnexion = document.getElementById("formulaire-connexion");
  if (formulaireConnexion) {
    const boutonConnexion = document.getElementById("bouton-connexion");
    const erreurConnexion = document.getElementById("erreur-connexion");

    formulaireConnexion.addEventListener("submit", async (e) => {
      e.preventDefault();
      erreurConnexion.textContent = "";
      boutonConnexion.disabled = true;
      boutonConnexion.textContent = "Connexion...";

      const identifiant = document.getElementById("identifiant").value.trim();
      const motDePasse = document.getElementById("mot-de-passe").value;

      try {
        const reponse = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: identifiant, password: motDePasse }),
        });
        const donnees = await reponse.json();
        if (donnees.ok) {
          window.location.href = "/accueil";
        } else {
          erreurConnexion.textContent = donnees.error || "Connexion impossible";
        }
      } catch (err) {
        erreurConnexion.textContent = "Erreur réseau, réessayez.";
      } finally {
        boutonConnexion.disabled = false;
        boutonConnexion.textContent = "Se connecter";
      }
    });
  }

  // ---------- Déconnexion (accueil + paramètres) ----------

  async function deconnecter() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  const boutonDeconnexion = document.getElementById("bouton-deconnexion");
  if (boutonDeconnexion) boutonDeconnexion.addEventListener("click", deconnecter);

  const boutonDeconnexionParametres = document.getElementById("bouton-deconnexion-parametres");
  if (boutonDeconnexionParametres) boutonDeconnexionParametres.addEventListener("click", deconnecter);

  // ---------- Page d'accueil ----------

  const texteBonjour = document.getElementById("texte-bonjour");
  if (texteBonjour) {
    const dateJour = document.getElementById("date-jour");
    if (dateJour) {
      dateJour.textContent = new Date().toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    }

    (async () => {
      const reponseMe = await appelApi("/api/me");
      const moi = await reponseMe.json();
      texteBonjour.textContent = `Bonjour ${moi.display_name}`;
      document.getElementById("texte-profil").textContent = moi.display_name;

      const avatar = document.getElementById("avatar-accueil");
      if (avatar) avatar.textContent = moi.display_name.charAt(0).toUpperCase();

      const reponseNonLus = await appelApi("/api/unread");
      const { unread } = await reponseNonLus.json();
      const badge = document.getElementById("badge-messages");
      const texteNotif = document.getElementById("texte-notifications");
      if (unread > 0) {
        badge.textContent = unread;
        badge.classList.remove("masque");
        texteNotif.textContent =
          unread === 1 ? "1 nouveau message" : `${unread} nouveaux messages`;
      }
    })();

    const ouvrirNotifications = document.getElementById("ouvrir-notifications");
    if (ouvrirNotifications) {
      ouvrirNotifications.addEventListener("click", () => {
        window.location.href = "/messagerie";
      });
    }
  }

  // ---------- Page profil ----------

  const profilNom = document.getElementById("profil-nom");
  if (profilNom) {
    (async () => {
      const reponse = await appelApi("/api/me");
      const moi = await reponse.json();
      profilNom.textContent = moi.display_name;
      document.getElementById("profil-identifiant").textContent = moi.username;
      document.getElementById("profil-autre").textContent = moi.other_display_name;
    })();
  }

  // ---------- Page conversation ----------

  const filMessages = document.getElementById("fil-messages");
  if (filMessages) {
    const titreConversation = document.getElementById("titre-conversation");
    const etatVide = document.getElementById("etat-vide-messages");
    const entreeTexte = document.getElementById("entree-texte");
    const boutonEnvoi = document.getElementById("bouton-envoi");
    const entreeImage = document.getElementById("entree-image");
    const boutonVocal = document.getElementById("bouton-vocal");

    let moiUsername = null;
    let dernierIdAffiche = 0;
    let dernierJourAffiche = null;
    let intervalleSondage = null;

    function faireDefilerEnBas() {
      filMessages.scrollTop = filMessages.scrollHeight;
    }

    function ajouterSeparateurJourSiBesoin(dateIso) {
      const jour = formaterJour(dateIso);
      if (jour !== dernierJourAffiche) {
        dernierJourAffiche = jour;
        const separateur = document.createElement("div");
        separateur.className = "jour-separateur";
        separateur.textContent = jour;
        filMessages.appendChild(separateur);
      }
    }

    function creerLecteurAudio(url) {
      const conteneur = document.createElement("div");
      conteneur.className = "lecteur-audio";
      conteneur.innerHTML = `
        <button type="button" class="bouton-lecture">▶️</button>
        <div class="barre-progression"><div class="avancement"></div></div>
        <span class="duree">0:00</span>
      `;
      const audio = new Audio(url);
      const boutonLecture = conteneur.querySelector(".bouton-lecture");
      const barreProgression = conteneur.querySelector(".barre-progression");
      const avancement = conteneur.querySelector(".avancement");
      const duree = conteneur.querySelector(".duree");

      audio.addEventListener("loadedmetadata", () => {
        duree.textContent = formaterDuree(audio.duration);
      });
      audio.addEventListener("timeupdate", () => {
        if (audio.duration) {
          avancement.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
          duree.textContent = formaterDuree(audio.duration - audio.currentTime);
        }
      });
      audio.addEventListener("ended", () => {
        boutonLecture.textContent = "▶️";
        avancement.style.width = "0%";
        duree.textContent = formaterDuree(audio.duration);
      });
      boutonLecture.addEventListener("click", () => {
        if (audio.paused) {
          audio.play();
          boutonLecture.textContent = "⏸️";
        } else {
          audio.pause();
          boutonLecture.textContent = "▶️";
        }
      });
      barreProgression.addEventListener("click", (e) => {
        const rect = barreProgression.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        if (audio.duration) audio.currentTime = ratio * audio.duration;
      });

      return conteneur;
    }

    function ajouterMessage(msg) {
      etatVide.classList.add("masque");
      ajouterSeparateurJourSiBesoin(msg.date);

      const estMoi = msg.utilisateur === moiUsername;
      const ligne = document.createElement("div");
      ligne.className = `ligne-message ${estMoi ? "moi" : msg.utilisateur}`;

      const trait = document.createElement("div");
      trait.className = "trait";
      ligne.appendChild(trait);

      const contenu = document.createElement("div");
      contenu.className = "contenu-message";

      if (msg.type === "texte") {
        const p = document.createElement("div");
        p.className = "texte-message";
        p.textContent = msg.contenu;
        contenu.appendChild(p);
      } else if (msg.type === "image") {
        const img = document.createElement("img");
        img.className = "image-message";
        img.src = `/images/${msg.fichier}`;
        img.alt = "Image envoyée";
        img.loading = "lazy";
        contenu.appendChild(img);
      } else if (msg.type === "audio") {
        contenu.appendChild(creerLecteurAudio(`/vocaux/${msg.fichier}`));
      }

      const heure = document.createElement("div");
      heure.className = "heure-message";
      heure.textContent = formaterHeure(msg.date);
      contenu.appendChild(heure);

      ligne.appendChild(contenu);
      filMessages.appendChild(ligne);
    }

    async function chargerMessages() {
      const reponse = await appelApi("/api/messages");
      const messages = await reponse.json();
      const nouveaux = messages.filter((m) => m.id > dernierIdAffiche);
      if (nouveaux.length === 0) return;
      nouveaux.forEach((m) => {
        ajouterMessage(m);
        dernierIdAffiche = Math.max(dernierIdAffiche, m.id);
      });
      faireDefilerEnBas();
    }

    async function initialiser() {
      const reponseMe = await appelApi("/api/me");
      const moi = await reponseMe.json();
      moiUsername = moi.username;
      titreConversation.textContent = moi.other_display_name;
      await chargerMessages();
      intervalleSondage = setInterval(chargerMessages, 3000);
    }

    // --- Envoi de texte ---

    function ajusterHauteurTexte() {
      entreeTexte.style.height = "auto";
      entreeTexte.style.height = Math.min(entreeTexte.scrollHeight, 100) + "px";
      boutonEnvoi.disabled = entreeTexte.value.trim().length === 0;
    }

    entreeTexte.addEventListener("input", ajusterHauteurTexte);
    entreeTexte.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        envoyerTexte();
      }
    });

    async function envoyerTexte() {
      const contenu = entreeTexte.value.trim();
      if (!contenu) return;
      entreeTexte.value = "";
      ajusterHauteurTexte();
      await appelApi("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contenu }),
      });
      await chargerMessages();
    }

    boutonEnvoi.addEventListener("click", envoyerTexte);

    // --- Envoi d'image ---

    entreeImage.addEventListener("change", async () => {
      const fichier = entreeImage.files[0];
      if (!fichier) return;
      const donnees = new FormData();
      donnees.append("image", fichier);
      await appelApi("/api/image", { method: "POST", body: donnees });
      entreeImage.value = "";
      await chargerMessages();
    });

    // --- Enregistrement vocal ---

    let enregistreurMedia = null;
    let morceauxAudio = [];
    let enregistrementEnCours = false;

    boutonVocal.addEventListener("click", async () => {
      if (!enregistrementEnCours) {
        try {
          const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
          morceauxAudio = [];
          enregistreurMedia = new MediaRecorder(flux);
          enregistreurMedia.ondataavailable = (e) => morceauxAudio.push(e.data);
          enregistreurMedia.onstop = async () => {
            flux.getTracks().forEach((t) => t.stop());
            const blob = new Blob(morceauxAudio, { type: "audio/webm" });
            const donnees = new FormData();
            donnees.append("vocal", blob, "message.webm");
            await appelApi("/api/vocal", { method: "POST", body: donnees });
            await chargerMessages();
          };
          enregistreurMedia.start();
          enregistrementEnCours = true;
          boutonVocal.classList.add("actif");
          boutonVocal.textContent = "⏹️";
        } catch (err) {
          alert("Impossible d'accéder au micro.");
        }
      } else {
        enregistreurMedia.stop();
        enregistrementEnCours = false;
        boutonVocal.classList.remove("actif");
        boutonVocal.textContent = "🎤";
      }
    });

    window.addEventListener("beforeunload", () => {
      if (intervalleSondage) clearInterval(intervalleSondage);
    });

    initialiser();
  }
})();

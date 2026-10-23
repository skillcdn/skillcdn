---
title: Data classification and handling at the Centre
description: The four data tiers of the Marrowfield Materials Characterization Centre, where each may be stored, how files and media are labelled, how data crosses the air gap, who releases data from the Centre, and how long each tier is kept.
---

# Data classification and handling at the Centre

This procedure binds every member of staff, student and visiting researcher of the Marrowfield Materials Characterization Centre (MMCC) who creates, stores, moves or destroys research data. It governs measurement data, processed results, reports and the media they live on, from the moment an instrument writes a file to the moment the last copy is destroyed.

## The four tiers and what each covers

The Centre handles data in four tiers. Tier 0 (open) is data cleared for publication or already published, including method descriptions and reference spectra. Tier 1 (internal) is ordinary unpublished work: raw diffractograms, micrographs, thermal analysis curves and the laboratory notebooks that describe them. Tier 2 (restricted) is data generated under a contract with a confidentiality clause, chiefly work for the Materiel Standards Directorate and for industrial partners under a materials transfer agreement. Tier 3 (controlled) is data whose release is limited by an export control or a defense classification order, such as fractography of failed components and alloy compositions received under a controlled program. The principal investigator sets the tier when a project is opened; the Data Steward confirms it within five working days, and an unconfirmed project is treated as Tier 2 until then.

## Approved storage for each tier

Each tier has a closed list of storage locations. Tier 0 and Tier 1 data may live on the Centre's networked file store, on instrument computers and on encrypted laptops managed by the Centre, and Tier 1 also in the collaboration space of the Office, but never on a personal device or consumer cloud account. Tier 2 data is confined to the project share, with access restricted to the named project team, and to the instrument computer that produced it for at most 30 days, after which the local copy is deleted. Tier 3 data exists only on the standalone network of the Controlled Data Room, which connects to no other network, and on the write-once media described below. A Tier 3 file found on any other system is a handling incident reported the same day.

## Labelling of files and media

Every file above Tier 0 carries its tier in the file name as a suffix before the extension, T1, T2 or T3, for example the diffraction data set 2026-0143-xrd-T2.xy. Reports and presentations carry the tier in the header and footer of every page together with the project number. Removable media carry a printed label with the medium's register number, the tier, the project number and the date written. The register number is MED, the two-digit year and a four-digit sequence, for example MED-26-0412, issued by the Data Steward when the medium enters service. Instrument computers that cannot name files freely, such as the controllers of the older thermal analyzers, export to a folder named for the tier, and the operator renames the files before they leave the instrument. An unlabelled medium is treated as Tier 3 until reviewed.

## Approved media and the write-once rule

Data crosses the air gap of the Controlled Data Room only on media that cannot be rewritten. The approved media are the write-once optical discs issued by the Data Steward and the single-session memory cards of the Centre's sealed transfer kit; USB flash drives and rewritable discs are forbidden on both sides of the gap, and a port blocker on the standalone network rejects unregistered devices. Each disc is written once, finalized, read back by a second person and never written again, so the chain of custody can be reconstructed from the disc itself. Media leaving the room are opened first on a dedicated transfer station outside it, for an antivirus scan and a comparison of the file hashes against the transfer log. A disc that fails verification is destroyed on the spot and the transfer repeated on a fresh medium.

## The transfer log and its signatures

Every movement of data across the air gap, in either direction, is entered on Form MMCC-3, the transfer log, before the medium leaves the room. The entry names the project, the register number of the medium, the number of files, the total size, the hash algorithm and the first eight characters of the hash of the manifest. Two signatures are required on every line, the person carrying out the transfer and a staff member who witnessed the write and the read-back, and neither may be a student. The Data Steward countersigns the log weekly and reconciles it against the media register; a medium that appears in one and not the other is reported to the Director of the Centre. The transfer log stays in the Controlled Data Room for the life of the room plus ten years.

## The release board

Nothing above Tier 0 leaves the Centre without the written decision of the release board, whether the recipient is a partner, a journal, the Office or another institute of the Federation. A request is made on Form MMCC-8 and names the data, its tier, the recipient, the purpose and the legal basis of the transfer, such as a contract clause or a Federation data-sharing agreement. The board has three members, the Data Steward, the Head of the laboratory concerned and the Centre's legal adviser, and decides within ten working days. A Tier 3 request additionally needs the written agreement of the originating formation of the VFDF, which the board obtains and which does not count against the ten days. A release is made as a logged transfer and the recipient confirms receipt in writing within five days.

## Retention periods by tier

Research data is kept for a fixed period from project closure, and the period rises with the tier. Tier 0 data is kept indefinitely in the Centre's open repository. Tier 1 data is kept for ten years from closure, the period the Federation research funders require for verifying published results. Tier 2 data is kept for the period written in the contract and never less than ten years, and the project share is frozen read-only on the day of closure. Tier 3 data is kept for 25 years or the period the controlling authority states, whichever is longer, and is reviewed every five years for a possible lowering of the tier. The Data Steward issues a destruction notice 90 days before a period ends; the principal investigator may extend retention five years at a time with a written justification.

## Destruction of media

Media are destroyed under the Centre's media destruction procedure, MMCC-QP-05, and the method depends on the highest tier the medium ever carried, not on what it carries now. Tier 1 media may be erased with a software overwrite and reused within the Centre. Tier 2 and Tier 3 magnetic media are degaussed and then shredded; optical media and solid-state devices are shredded in the Controlled Data Room, and the Centre follows VDS 1021 for the sanitization of media that carried controlled data. Every destruction is witnessed by two people and recorded against the register number, so the media register shows for every medium its date of issue, its highest tier and its date of destruction. A failed instrument hard drive is destroyed and never returned to the manufacturer under warranty; the procurement file records that the drive was withheld.

## Data found at the wrong tier

When data is found on a system or medium not approved for its tier, the finder stops work on that system, leaves the data in place and informs the Data Steward by telephone, not email, within the hour. The Data Steward isolates the system, records the finding in the incident register with file names, tier and location, and decides with the Head of the laboratory whether anyone not entitled saw it. For Tier 3 data the originating formation is informed within 24 hours of the finding, whatever the outcome. The data is moved to an approved location by a logged transfer, the wrong copy is destroyed under MMCC-QP-05, and the incident closes with a short written cause analysis. The finder is never blamed; whoever misfiled the data receives training, and only a repeated or deliberate misfiling is disciplinary.

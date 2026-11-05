package com.zyger.vms.repository;

import java.util.List;
import java.util.Optional;

import com.zyger.vms.domain.VisitorProfile;

import org.springframework.data.jpa.repository.JpaRepository;

public interface VisitorProfileRepository extends JpaRepository<VisitorProfile, Long> {

    Optional<VisitorProfile> findByPhone(String phone);

    List<VisitorProfile> findTop10ByFullNameContainingIgnoreCaseOrPhoneContaining(String name, String phone);
}

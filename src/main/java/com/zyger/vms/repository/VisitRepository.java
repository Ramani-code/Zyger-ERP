package com.zyger.vms.repository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import com.zyger.vms.domain.Visit;
import com.zyger.vms.domain.VisitStatus;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface VisitRepository extends JpaRepository<Visit, Long> {

    @Query("""
            select v from Visit v
              join fetch v.visitor vis
              left join fetch v.department d
            where lower(vis.fullName) like :name
              and (:department = '' or d.name = :department)
              and v.status in :statuses
              and v.visitDate between :fromDate and :toDate
            order by v.visitDate desc, v.visitTime asc, v.id asc
            """)
    List<Visit> search(@Param("name") String name,
                       @Param("department") String department,
                       @Param("statuses") Collection<VisitStatus> statuses,
                       @Param("fromDate") LocalDate fromDate,
                       @Param("toDate") LocalDate toDate);

    @EntityGraph(attributePaths = {"visitor", "department"})
    Optional<Visit> findByVisitCode(String visitCode);

    @EntityGraph(attributePaths = {"visitor", "department"})
    Optional<Visit> findByPassIdIgnoreCase(String passId);

    @EntityGraph(attributePaths = {"visitor", "department"})
    List<Visit> findByVisitDate(LocalDate visitDate);

    @EntityGraph(attributePaths = {"department"})
    Optional<Visit> findFirstByVisitorIdOrderByIdDesc(Long visitorId);

    @EntityGraph(attributePaths = {"visitor", "department"})
    List<Visit> findByStatusAndCheckInAtBefore(VisitStatus status, LocalDateTime checkInAt);

    @EntityGraph(attributePaths = {"visitor", "department"})
    List<Visit> findByCheckInAtGreaterThanEqualAndCheckInAtLessThanOrderByCheckInAtDesc(
            LocalDateTime from, LocalDateTime to);

    boolean existsByVisitorId(Long visitorId);

    long countByStatus(VisitStatus status);

    long countByVisitDate(LocalDate visitDate);

    long countByVisitDateAndStatus(LocalDate visitDate, VisitStatus status);

    @Query(value = "select nextval('visit_code_seq')", nativeQuery = true)
    Long nextCodeNumber();
}

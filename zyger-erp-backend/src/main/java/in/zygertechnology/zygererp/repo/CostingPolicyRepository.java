package in.zygertechnology.zygererp.repo;

import in.zygertechnology.zygererp.entity.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface CostingPolicyRepository extends JpaRepository<CostingPolicy, Long> {
    Optional<CostingPolicy> findFirstByActiveTrue();
}
